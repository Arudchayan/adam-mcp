import assert from "node:assert/strict";
import { test } from "node:test";
import { AdamError } from "adam-core";
import { SerialQueue } from "./serial-queue.ts";
import { SharedOperation } from "./request-lifecycle.ts";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

test("drops progress while a subscriber is busy without holding shared completion", async () => {
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let calls = 0;
  const operation = new SharedOperation(async (_signal, report) => {
    await report({ progress: 1 });
    await started;
    for (let i = 0; i < 100; i++) await report({ progress: i + 2 });
    return 42;
  });
  const slow = operation.join(undefined, () => { calls++; entered(); return blocked; });
  const healthy = operation.join();
  try {
    assert.equal(await healthy, 42);
    assert.equal(await slow, 42);
    assert.equal(calls, 1);
  } finally { release(); }
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const cancelled = (error: unknown) => error instanceof AdamError && error.code === "cancelled";

test("seed 0x51a7: cancellation reclaims admission without changing FIFO (960 entries)", async () => {
  let seed = 0x51a7;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let round = 0; round < 40; round++) {
    const queue = new SerialQueue({ maxPending: 24 });
    const gate = deferred();
    const active = queue.enqueue(() => gate.promise);
    const controllers = Array.from({ length: 24 }, () => new AbortController());
    const ran: number[] = [];
    const pending = controllers.map((controller, i) => queue.enqueue(async () => { ran.push(i); return i; }, controller.signal));
    const settled = Promise.allSettled(pending);
    await assert.rejects(queue.enqueue(async () => -1), (e: unknown) => e instanceof AdamError && e.retryable === true);
    const removed = controllers.map(() => (random() >>> 28) < 5);
    controllers.forEach((controller, i) => { if (removed[i]) controller.abort(); });
    const replacements = removed.flatMap((remove, i) => remove ? [queue.enqueue(async () => { ran.push(24 + i); return 24 + i; })] : []);
    gate.resolve();
    await active;
    const results = await settled;
    await Promise.all(replacements);
    assert.deepEqual(ran, [...controllers.flatMap((_, i) => removed[i] ? [] : [i]), ...removed.flatMap((remove, i) => remove ? [24 + i] : [])]);
    results.forEach((result, i) => assert.equal(result.status, removed[i] ? "rejected" : "fulfilled"));
  }
});

test("deadline removes a queued entry; cancellation of uncooperative active work never permits overlap", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const queue = new SerialQueue({ maxPending: 1, waitTimeoutMs: 50 });
  const gate = deferred();
  const controller = new AbortController();
  const active = queue.enqueue(() => gate.promise, controller.signal);
  const activeRejected = assert.rejects(active, cancelled);
  let ran = false;
  const waiting = queue.enqueue(async () => { ran = true; });
  const timedOut = assert.rejects(waiting, (e: unknown) => e instanceof AdamError && e.code === "provider_unavailable" && e.retryable === true);
  controller.abort();
  await activeRejected;
  t.mock.timers.tick(50);
  await timedOut;
  assert.equal(ran, false);
  const next = queue.enqueue(async () => { ran = true; });
  assert.equal(ran, false);
  gate.resolve();
  await next;
  assert.equal(ran, true);
});

test("shared abandonment cancels once; another subscriber survives a peer abort and failed notification", async () => {
  const gate = deferred();
  const started = deferred();
  let sharedSignal!: AbortSignal;
  const operation = new SharedOperation(async (signal, report) => {
    sharedSignal = signal;
    await report({ progress: 1 });
    started.resolve();
    await gate.promise;
    return 7;
  });
  const a = new AbortController();
  const b = new AbortController();
  const first = operation.join(a.signal, async () => { throw new Error("host notification rejected"); });
  const rejected = assert.rejects(first, cancelled);
  const second = operation.join(b.signal);
  await started.promise;
  a.abort();
  await rejected;
  assert.equal(sharedSignal.aborted, false);
  gate.resolve();
  assert.equal(await second, 7);

  const abandonedGate = deferred();
  const abandoned = new SharedOperation(async () => abandonedGate.promise);
  const owner = new AbortController();
  const joined = abandoned.join(owner.signal);
  const abandonedRejected = assert.rejects(joined, cancelled);
  owner.abort();
  await abandonedRejected;
  assert.equal(abandoned.aborted, true);
  await assert.rejects(abandoned.join(), cancelled);
  abandonedGate.resolve();
  await abandoned.promise.catch(() => undefined);
});

test("login invalidation rejects a late memory read and never caches its stale completion", async () => {
  const url = "https://adam.unibas.ch";
  const snapshot = snapshotFromHtml(url, "Dashboard", '<main><a href="/logout.php">Abmelden</a></main>', "Dashboard Abmelden");
  const memory = createMemorySession({ [url]: snapshot });
  const entered = deferred();
  const release = deferred();
  const open = memory.open.bind(memory);
  let reads = 0;
  memory.open = async (target, options) => {
    reads++;
    if (reads === 1) { entered.resolve(); await release.promise; }
    return open(target, options);
  };
  const provider = createBrowserProvider({ session: memory });
  try {
    const stale = provider.listCourses();
    const rejected = assert.rejects(stale, cancelled);
    await entered.promise;
    await provider.login();
    await rejected;
    release.resolve();
    await provider.listCourses();
    assert.equal(reads, 2);
    await provider.listCourses();
    assert.equal(reads, 3, "dashboard listings intentionally refresh instead of reusing stale home content");
  } finally { release.resolve(); await provider.close(); }
});
