import assert from "node:assert/strict";
import { it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import { SerialQueue } from "./serial-queue.ts";
import { SharedOperation, waitForSignal } from "./request-lifecycle.ts";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const cancelled = (error: unknown) => error instanceof AdamError && error.code === "cancelled";
const origin = "https://adam.unibas.ch";
const url = `${origin}/go/crs/100001`;
const course = () => snapshotFromHtml(url, "Course", '<main><h1>Course</h1><a href="/go/file/100011">Notes.pdf</a><a href="/logout.php">Abmelden</a></main>', "Course Notes.pdf Abmelden");
const home = () => snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard", '<main><a href="/go/crs/100001">Course</a></main>', "Dashboard Course Abmelden");

it("shares page navigation and parsing across concurrent and repeated reads", async () => {
  const gate = deferred();
  let opens = 0, htmlReads = 0;
  const page = new Proxy(course(), { get(target, key, receiver) {
    if (key === "html") htmlReads++;
    return Reflect.get(target, key, receiver);
  } });
  const session = createMemorySession({ [url]: page });
  const provider = createBrowserProvider({ session: { ...session, async open(target) {
    opens++; await gate.promise; return session.open(target);
  } } });
  const first = provider.getCourse("100001");
  const second = provider.listFiles("100001", { type: "crs" });
  gate.resolve();
  await Promise.all([first, second]);
  const parsedReads = htmlReads;
  await provider.listChildren("100001", { type: "crs" });
  await provider.readPage("100001", { type: "crs" });
  assert.equal(opens, 1, "all four calls must share one navigation");
  assert.ok(parsedReads > 0);
  assert.equal(htmlReads, parsedReads, "cached reads must not repeat catalog parsing");
});

it("cancels a page read before its open resolves and does not cache the abandoned result", async () => {
  const gate = deferred(), entered = deferred();
  let opens = 0;
  const session = createMemorySession({ [url]: course() });
  const provider = createBrowserProvider({ session: { ...session, async open(target, options) {
    opens++; if (opens === 1) { entered.resolve(); await gate.promise; }
    assert.equal(options?.signal?.aborted, opens === 1);
    return session.open(target);
  } } });
  const controller = new AbortController();
  const task = provider.readPage("100001", { type: "crs", signal: controller.signal });
  const rejection = assert.rejects(task, cancelled);
  await entered.promise; controller.abort();
  await rejection; // Must finish before releasing the uncooperative test open.
  assert.equal((await provider.readPage("100001", { type: "crs" })).title, "Course");
  gate.resolve();
  assert.equal(opens, 2);
});

for (const abortFirst of [true, false]) {
  it(`shares a walk while cancelling only the ${abortFirst ? "initiating" : "later"} caller`, async () => {
    const gate = deferred(), entered = deferred();
    let opens = 0;
    const session = createMemorySession({ [origin]: home(), [url]: course() });
    const provider = createBrowserProvider({ session: { ...session, async open(target, options) {
      opens++; if (target === origin) { entered.resolve(); await waitForSignal(gate.promise, options?.signal); }
      return session.open(target);
    } } });
    const firstController = new AbortController(), secondController = new AbortController();
    const firstProgress: number[] = [], secondProgress: number[] = [];
    const first = provider.search("Notes", { signal: firstController.signal, onProgress: (step) => { firstProgress.push(step.progress); } });
    await entered.promise;
    const second = provider.listNews({ signal: secondController.signal, onProgress: (step) => { secondProgress.push(step.progress); } });
    // Let the second caller finish its async logout check and subscribe.
    await new Promise<void>((done) => setImmediate(done));
    const rejection = assert.rejects(abortFirst ? first : second, cancelled);
    (abortFirst ? firstController : secondController).abort();
    await rejection;
    gate.resolve();
    await (abortFirst ? second : first);
    assert.equal(opens, 2, "two callers share exactly one dashboard + course walk");
    assert.ok((abortFirst ? secondProgress : firstProgress).length >= 2);
    assert.equal((abortFirst ? firstProgress : secondProgress).length, 0);
  });
}

it("aborts shared work when its last subscriber leaves", async () => {
  const entered = deferred();
  let workSignal: AbortSignal | undefined;
  const operation = new SharedOperation<void>(async (signal) => {
    workSignal = signal; entered.resolve();
    await waitForSignal(new Promise<void>(() => {}), signal);
  });
  const controller = new AbortController();
  const rejection = assert.rejects(operation.join(controller.signal), cancelled);
  await entered.promise; controller.abort(); await rejection;
  assert.equal(workSignal?.aborted, true);
});

it("returns honest partial data at the elapsed budget and never memoizes it", async () => {
  let courseOpens = 0;
  const session = createMemorySession({ [origin]: home(), [url]: course() });
  const provider = createBrowserProvider({ walkTimeoutMs: 30, session: { ...session, async open(target, options) {
    if (target === url && ++courseOpens === 1) await waitForSignal(new Promise<void>(() => {}), options?.signal);
    return session.open(target);
  } } });
  const partial = await provider.search("Notes");
  assert.equal(partial.partial, true);
  assert.equal(partial.partialReason, "time_budget");
  assert.deepEqual(partial.items, []);
  const retry = await provider.search("Notes");
  assert.ok(retry.items.some((item) => item.refId === "100011"));
  assert.equal(retry.partial, undefined);
  assert.equal(courseOpens, 2);
});

it("cancels queued work immediately without executing it or blocking subsequent work", async () => {
  const queue = new SerialQueue(), gate = deferred(), entered = deferred();
  const active = queue.enqueue(async () => { entered.resolve(); await gate.promise; });
  await entered.promise;
  const controller = new AbortController();
  let executed = false;
  const rejection = assert.rejects(queue.enqueue(async () => { executed = true; }, controller.signal), cancelled);
  controller.abort(); await rejection;
  const next = queue.enqueue(async () => "next");
  gate.resolve(); await active;
  assert.equal(await next, "next");
  assert.equal(executed, false);
});

it("bounds queued admission and waiting without overlapping active work", async () => {
  const queue = new SerialQueue({ maxPending: 1, waitTimeoutMs: 20 });
  const gate = deferred(), entered = deferred();
  const active = queue.enqueue(async () => { entered.resolve(); await gate.promise; });
  await entered.promise;
  let executed = false;
  const waiting = assert.rejects(queue.enqueue(async () => { executed = true; }),
    (error: unknown) => error instanceof AdamError && error.code === "provider_unavailable" && error.retryable);
  await assert.rejects(queue.enqueue(async () => {}), /queue is full/);
  await waiting;
  gate.resolve(); await active;
  assert.equal(executed, false);
  assert.equal(await queue.enqueue(async () => "recovered"), "recovered");
});

it("refreshes a reused in-process snapshot's parsed catalog after the TTL", async () => {
  let clock = 0, opens = 0;
  const page = course();
  const provider = createBrowserProvider({ clock: () => clock, session: createMemorySession({ [url]: page }, { onOpen: () => opens++ }) });
  assert.equal((await provider.readPage("100001", { type: "crs" })).title, "Course");
  page.html = page.html.replace("<h1>Course</h1>", "<h1>Updated course</h1>");
  page.text = "Updated course Abmelden";
  clock = 60_001;
  assert.equal((await provider.readPage("100001", { type: "crs" })).title, "Updated course");
  assert.equal(opens, 2);
});

it("bounds a walk even when the host's progress callback never resolves", async () => {
  const provider = createBrowserProvider({ walkTimeoutMs: 20, session: createMemorySession({ [origin]: home(), [url]: course() }) });
  await assert.rejects(() => provider.search("Notes", { onProgress: () => new Promise<void>(() => {}) }),
    (error: unknown) => error instanceof AdamError && error.code === "provider_unavailable" && error.retryable);
  assert.ok((await provider.search("Notes")).items.length > 0);
});

it("a cancelled caller's stuck progress callback does not hold up another subscriber", async () => {
  const reporting = deferred();
  const provider = createBrowserProvider({ session: createMemorySession({ [origin]: home(), [url]: course() }) });
  const controller = new AbortController();
  const first = provider.search("Notes", { signal: controller.signal, onProgress: () => {
    reporting.resolve();
    return new Promise<void>(() => {});
  } });
  const rejected = assert.rejects(first, cancelled);
  await reporting.promise;
  const second = provider.search("Notes");
  await new Promise<void>((done) => setImmediate(done));
  controller.abort(); await rejected;
  assert.ok((await second).items.some((item) => item.refId === "100011"));
});
