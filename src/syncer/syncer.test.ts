import { assertEquals, assert } from "@std/assert";
import { Peer } from "../peer/peer.ts";
import { RuntimeDriverUniversal } from "../runtime/driver_universal.ts";
import { StorageDriverMemory } from "../peer/storage_drivers/memory.ts";
import { Path } from "../path/path.ts";
import { syncInMemory } from "./sync_in_memory.ts";
import type { EarthstarError } from "../../mod.ts";
import { isErr } from "../util/errors.ts";
import { delay } from "@std/async/delay";

const handleErr = <T>(data: T | EarthstarError): T => {
  if (isErr(data)) throw data;
  return data;
};

Deno.test("Sync 2 Peers In Memory", async () => {
  const p1 = new Peer({
    password: "password",
    runtime: new RuntimeDriverUniversal(),
    storage: new StorageDriverMemory(),
  });
  const p2 = new Peer({
    password: "password",
    runtime: new RuntimeDriverUniversal(),
    storage: new StorageDriverMemory(),
  });
  const id1 = handleErr(await p1.createIdentity("mid1"));
  const id2 = handleErr(await p2.createIdentity("mid2"));

  const share = handleErr(await p1.createShare("share", false));

  const capRead1 = handleErr(await p1.mintCap(share.tag, id1.tag, "write"));
  const capWrite1 = handleErr(await p1.mintCap(share.tag, id1.tag, "read"));

  // TODO(zicklag): using these to lines instead of the following will not work, but I think they should.
  // const capRead2 = handleErr(await p1.mintCap(share, id2.tag, "write"));
  // const capWrite2 = handleErr(await p1.mintCap(share, id2.tag, "read"));

  const capRead2 = handleErr(await capRead1.delegate(id2.tag));
  const capWrite2 = handleErr(await capWrite1.delegate(id2.tag));

  const store1 = handleErr(await p1.getStore(share.tag));

  handleErr(
    await store1.set({
      identity: id1.tag,
      path: Path.fromStrings("hello"),
      payload: new TextEncoder().encode("world"),
    })
  );

  handleErr(await p2.importCap(capRead2.export()));
  handleErr(await p2.importCap(capWrite2.export()));

  const syncers = handleErr(
    await syncInMemory(p1, p2, {
      runtime: new RuntimeDriverUniversal(),
    })
  );

  await delay(1000);

  syncers[0].close();
  syncers[1].close();

  const store2 = handleErr(await p2.getStore(share.tag));

  const get = handleErr(await store2.get(id1.tag, Path.fromStrings("hello")));
  assert(get && get.payload, "Record not synced");
  const valueBytes = handleErr(await get.payload.bytes());
  const valueStr = handleErr(new TextDecoder().decode(valueBytes));
  assertEquals(valueStr, "world");
});

// Deno.test("Syncing is eager", async () => {
//   const p1 = new Peer({
//     password: "password",
//     runtime: new RuntimeDriverUniversal(),
//     storage: new StorageDriverMemory(),
//   });
//   const p2 = new Peer({
//     password: "password",
//     runtime: new RuntimeDriverUniversal(),
//     storage: new StorageDriverMemory(),
//   });
//   const id1 = handleErr(await p1.createIdentity("mid1"));
//   const id2 = handleErr(await p2.createIdentity("mid2"));

//   const share = handleErr(await p1.createShare("share", false));

//   const capRead1 = handleErr(await p1.mintCap(share.tag, id1.tag, "write"));
//   const capWrite1 = handleErr(await p1.mintCap(share.tag, id1.tag, "read"));

//   // TODO(zicklag): using these to lines instead of the following will not work, but I think they should.
//   // const capRead2 = handleErr(await p1.mintCap(share, id2.tag, "write"));
//   // const capWrite2 = handleErr(await p1.mintCap(share, id2.tag, "read"));

//   const capRead2 = handleErr(await capRead1.delegate(id2.tag));
//   const capWrite2 = handleErr(await capWrite1.delegate(id2.tag));

//   const store1 = handleErr(await p1.getStore(share.tag));

//   handleErr(await p2.importCap(capRead2.export()));
//   handleErr(await p2.importCap(capWrite2.export()));

//   const syncers = handleErr(
//     await syncInMemory(p1, p2, {
//       runtime: new RuntimeDriverUniversal(),
//     })
//   );

//   await delay(1000);

//   handleErr(
//     await store1.set({
//       identity: id1.tag,
//       path: Path.fromStrings("hello"),
//       payload: new TextEncoder().encode("world"),
//     })
//   );

//   await delay(1000);

//   syncers[0].close();
//   syncers[1].close();

//   const store2 = handleErr(await p2.getStore(share.tag));

//   const get = handleErr(await store2.get(id1.tag, Path.fromStrings("hello")));
//   assert(get && get.payload, "Record not synced");
//   const valueBytes = handleErr(await get.payload.bytes());
//   const valueStr = handleErr(new TextDecoder().decode(valueBytes));
//   assertEquals(valueStr, "world");
// });

Deno.test("Sync through 3rd party", async () => {
  // Create 3 peers
  const p1 = new Peer({
    password: "password",
    runtime: new RuntimeDriverUniversal(),
    storage: new StorageDriverMemory(),
  });
  const p2 = new Peer({
    password: "password",
    runtime: new RuntimeDriverUniversal(),
    storage: new StorageDriverMemory(),
  });
  const server = new Peer({
    password: "password",
    runtime: new RuntimeDriverUniversal(),
    storage: new StorageDriverMemory(),
  });

  // Create an identity for each peer
  const id1 = handleErr(await p1.createIdentity("mid1"));
  const id2 = handleErr(await p2.createIdentity("mid2"));
  const idServer = handleErr(await server.createIdentity("srvr"));

  // Create a share on peer 1
  const share = handleErr(await p1.createShare("share", false));

  // Give root permissions to peer 1
  const capRead1 = handleErr(await p1.mintCap(share.tag, id1.tag, "write"));
  const capWrite1 = handleErr(await p1.mintCap(share.tag, id1.tag, "read"));
  const store1 = handleErr(await p1.getStore(share.tag));

  // Grant read permission to the server
  const capServerRead = handleErr(await capRead1.delegate(idServer.tag));
  const capServerWrite = handleErr(await capWrite1.delegate(idServer.tag));
  handleErr(await server.importCap(capServerRead.export()));
  handleErr(server.importCap(capServerWrite.export()));
  const storeServer = handleErr(await server.getStore(share.tag));

  // Great read / write permissions to peer 2
  const capRead2 = handleErr(await capRead1.delegate(id2.tag));
  const capWrite2 = handleErr(await capWrite1.delegate(id2.tag));
  handleErr(await p2.importCap(capRead2.export()));
  handleErr(await p2.importCap(capWrite2.export()));
  const store2 = handleErr(await p2.getStore(share.tag));

  // Sync p1 to the server
  const [p1ToServer, serverFromP1] = handleErr(
    await syncInMemory(p1, server, {
      runtime: new RuntimeDriverUniversal(),
    })
  );

  // Sync p2 with the server
  const [p2ToServer, serverFromP2] = handleErr(
    await syncInMemory(p2, server, {
      runtime: new RuntimeDriverUniversal(),
    })
  );

  // Add a record to peer one
  handleErr(
    await store1.set({
      identity: id1.tag,
      path: Path.fromStrings("hello"),
      payload: new TextEncoder().encode("world"),
    })
  );

  p1ToServer.forceReconcile();

  await delay(1000);

  // Make sure the data exists on the server
  const serverGet = handleErr(
    await storeServer.get(id1.tag, Path.fromStrings("hello"))
  );
  assert(serverGet && serverGet.payload, "Record not synced");
  const serverValueBytes = handleErr(await serverGet.payload.bytes());
  const serverValueStr = handleErr(new TextDecoder().decode(serverValueBytes));
  assertEquals(serverValueStr, "world");

  serverFromP2.forceReconcile();

  await delay(1000);

  // Make sure the data exists on peer 2
  const get = handleErr(await store2.get(id1.tag, Path.fromStrings("hello")));
  assert(get && get.payload, "Record not synced");
  const valueBytes = handleErr(await get.payload.bytes());
  const valueStr = handleErr(new TextDecoder().decode(valueBytes));
  assertEquals(valueStr, "world");

  p1ToServer.close();
  serverFromP1.close();
  p2ToServer.close();
  serverFromP2.close();
});
