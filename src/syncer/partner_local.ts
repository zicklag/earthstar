import { FormatsArg } from "../formats/default.ts";
import { IPeer } from "../peer/peer-types.ts";
import { BlockingBus } from "../streams/stream_utils.ts";
import { isErr } from "../util/errors.ts";
import { ValidationError } from "../util/errors.ts";
import { Syncer } from "./syncer.ts";
import {
  GetTransferOpts,
  ISyncPartner,
  SyncerEvent,
  SyncerMode,
} from "./syncer_types.ts";

export class PartnerLocal<
  FormatsType,
  IncomingTransferSourceType extends undefined,
> implements ISyncPartner<undefined> {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;

  private incomingEventBus = new BlockingBus<SyncerEvent>();
  private outgoingEventBus = new BlockingBus<SyncerEvent>();
  private partnerPeer: IPeer;

  // Need this for testing.
  partnerSyncer: Syncer<IncomingTransferSourceType, FormatsType>;

  constructor(
    peer: IPeer,
    peerSelf: IPeer,
    mode: SyncerMode,
    formats?: FormatsArg<FormatsType>,
  ) {
    this.partnerPeer = peer;

    const { incomingEventBus, outgoingEventBus } = this;

    // This is a bit confusing, but it does work.

    // We subscribe this driver's readable stream of outgoing events to our outgoing event bus.
    this.readable = new ReadableStream<SyncerEvent>({
      start(controller) {
        outgoingEventBus.on((event) => {
          controller.enqueue(event);
        });
      },
    });

    // We make the writable stream of incoming events write to the incoming event bus.
    this.writable = new WritableStream<SyncerEvent>({
      async write(event) {
        await incomingEventBus.send(event);
      },
    });

    // This will be the partner of our partner, which is us.

    // Now we create another syncer within this driver
    // But this syncer needs its own driver...
    // We'll give it one that proxies to the readable / writable pair we defined above.

    this.partnerSyncer = new Syncer<IncomingTransferSourceType, FormatsType>({
      peer,
      formats,
      partner: {
        // Events written by the partner syncer will be sent to the outgoing event bus
        // And thus to the readable stream.
        writable: new WritableStream({
          async write(event) {
            await outgoingEventBus.send(event);
          },
        }),
        // Events sent to the incoming event bus will be sent to the readable stream here.
        readable: new ReadableStream({
          start(controller) {
            incomingEventBus.on((event) => {
              controller.enqueue(event);
            });
          },
        }),
        async getDownload(
          opts: GetTransferOpts,
        ): Promise<ReadableStream<Uint8Array> | ValidationError | undefined> {
          const partnerReplica = peerSelf.getReplica(opts.shareAddress);

          if (!partnerReplica) {
            return new ValidationError(
              "Tried to get a receiving transfer for an unknown share.",
            );
          }

          const blob = await partnerReplica.replicaDriver.blobDriver.getBlob(
            opts.doc.format,
            opts.attachmentHash,
          );

          if (!blob) {
            return undefined;
          }

          if (isErr(blob)) {
            return;
          }

          return await blob.stream();
        },
        handleUploadRequest(
          _opts: GetTransferOpts,
        ): Promise<WritableStream<Uint8Array> | ValidationError | undefined> {
          // Just return undefined here because we know how to directly get a transfer from this partner.
          return Promise.resolve(undefined);
        },
        handleTransferRequest(
          _source: IncomingTransferSourceType,
          _kind: "upload" | "download",
        ): Promise<
          | ReadableStream<Uint8Array>
          | WritableStream<Uint8Array>
          | ValidationError
          | undefined
        > {
          // Don't need to implement this either.
          return Promise.resolve(undefined);
        },
      },
      mode,
    });
  }

  async getDownload(
    opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | ValidationError | undefined> {
    const partnerReplica = this.partnerPeer.getReplica(opts.shareAddress);

    if (!partnerReplica) {
      return new ValidationError(
        "Tried to get a receiving transfer for an unknown share.",
      );
    }

    const blob = await partnerReplica.replicaDriver.blobDriver.getBlob(
      opts.doc.format,
      opts.attachmentHash,
    );

    if (!blob) {
      return undefined;
    }

    if (isErr(blob)) {
      return;
    }

    return await blob.stream();
  }

  handleUploadRequest(
    _opts: GetTransferOpts,
  ): Promise<WritableStream<Uint8Array> | ValidationError | undefined> {
    // Just return undefined here because we know how to directly get a transfer from this partner.
    return Promise.resolve(undefined);
  }

  handleTransferRequest(
    _source: IncomingTransferSourceType,
    _kind: "upload" | "download",
  ): Promise<
    | ReadableStream<Uint8Array>
    | WritableStream<Uint8Array>
    | ValidationError
    | undefined
  > {
    // Don't need to implement this either.
    return Promise.resolve(undefined);
  }
}
