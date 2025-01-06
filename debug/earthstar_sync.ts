import { assert } from "https://deno.land/std@0.203.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.203.0/assert/assert_equals.ts";
import { Peer } from "../src/peer/peer.ts";
import { notErr } from "../src/util/errors.ts";
import { syncInMemory } from "../src/syncer/sync_in_memory.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";
import { getStorageDriverFilesystem, RuntimeDriverDeno } from "../mod.deno.ts";
import { Path, StorageDriverMemory } from "../mod.ts";

// ALFIE

const peer = new Peer({
  password: "password1234",
  runtime: new RuntimeDriverDeno(),
  storage: new StorageDriverMemory(),
});

assertEquals(await peer.shares(), []);

const alfieKeypair = await peer.createIdentity("alfi");
assert(notErr(alfieKeypair));

const gardeningKeypair = await peer.createShare("gardening", false);
assert(notErr(gardeningKeypair));

const gardeningRootWriteCap = await peer.mintCap(
  gardeningKeypair.tag,
  alfieKeypair.tag,
  "write",
);
assert(notErr(gardeningRootWriteCap));
const gardeningRootReadCap = await peer.mintCap(
  gardeningKeypair.tag,
  alfieKeypair.tag,
  "read",
);
assert(notErr(gardeningRootReadCap));

assertEquals(await peer.shares(), [gardeningKeypair.tag]);
const gardeningAlfie = await peer.getStore(gardeningKeypair.tag);
assert(notErr(gardeningAlfie));

const result = await gardeningAlfie.set({
  path: Path.fromStrings("hello"),
  identity: alfieKeypair.tag,
  payload: new TextEncoder().encode("yo!"),
});
assertEquals(result.kind, "success");

// BETTY

const peer2 = new Peer({
  password: "password2345",
  runtime: new RuntimeDriverDeno(),
  storage: new StorageDriverMemory(),
});

const bettyKeypair = await peer2.createIdentity("bett");
assert(notErr(bettyKeypair));

const delWriteCap = await peer.mintCap(gardeningKeypair.tag, bettyKeypair.tag, "write")
assert(notErr(delWriteCap));
assert(await delWriteCap.isValid());

const delReadCap = await peer.mintCap(gardeningKeypair.tag, bettyKeypair.tag, "read");
assert(notErr(delReadCap));
assert(await delReadCap.isValid());

assert(notErr(await peer2.importCap(delWriteCap.export())));
assert(notErr(await peer2.importCap(delReadCap.export())));

assertEquals(await peer2.shares(), [gardeningKeypair.tag]);
const gardeningBetty = await peer2.getStore(gardeningKeypair.tag);
assert(notErr(gardeningBetty));

const result2 = await gardeningBetty.set({
  path: Path.fromStrings("hello"),
  identity: bettyKeypair.tag,
  payload: new TextEncoder().encode("greetings!"),
});
assertEquals(result2.kind, "success");

// NOW SYNC!

const syncers = await syncInMemory(peer, peer2, {
  runtime: new RuntimeDriverDeno(),
});
await delay(1000);
assert(notErr(syncers));

syncers[0].close();
syncers[1].close();

console.group("Alfie has...");
for await (const doc of gardeningAlfie.documents()) {
  console.log(doc);
}
console.groupEnd();

console.group("Betty has...");
for await (const doc of gardeningBetty.documents()) {
  console.log(doc);
}
console.groupEnd();
