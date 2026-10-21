import assert from "node:assert/strict";
import { it } from "node:test";
import { WeightedQueue } from "./weighted-queue.ts";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it("bounds queued counts/bytes and releases cancelled input before recovery", async () => {
  const queue = new WeightedQueue({ maxPending: 2, maxBytes: 10, waitMs: 1000 });
  const hold = gate();
  const active = queue.enqueue(100, () => hold.promise);
  const controller = new AbortController();
  const cancelled = assert.rejects(queue.enqueue(6, async () => assert.fail("cancelled work ran"), controller.signal), /cancelled/);
  await assert.rejects(queue.enqueue(5, async () => {}), /queue is full/);
  const next = queue.enqueue(4, async () => "next");
  await assert.rejects(queue.enqueue(0, async () => {}), /queue is full/);
  controller.abort(); await cancelled;
  const replacement = queue.enqueue(6, async () => "replacement");
  hold.resolve(); await active;
  assert.equal(await next, "next");
  assert.equal(await replacement, "replacement");
  assert.equal(await queue.enqueue(10, async () => "recovered"), "recovered");
});

it("expires waiting work without executing it or overlapping active work", async () => {
  const queue = new WeightedQueue({ maxPending: 1, maxBytes: 10, waitMs: 10 });
  const hold = gate();
  const active = queue.enqueue(1, () => hold.promise);
  await assert.rejects(queue.enqueue(10, async () => assert.fail("expired work ran")), /queue wait exceeded/);
  const next = queue.enqueue(10, async () => "next");
  hold.resolve(); await active;
  assert.equal(await next, "next");
});

it("drains after task failure and refuses already cancelled work", async () => {
  const queue = new WeightedQueue({ maxPending: 1, maxBytes: 10, waitMs: 1000 });
  const hold = gate();
  const failed = assert.rejects(queue.enqueue(1, async () => { await hold.promise; throw new Error("failed"); }), /failed/);
  const next = queue.enqueue(10, async () => 42);
  hold.resolve(); await failed; assert.equal(await next, 42);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => queue.enqueue(1, async () => assert.fail(), controller.signal), /cancelled/);
});
