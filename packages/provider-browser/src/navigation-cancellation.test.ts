import assert from "node:assert/strict";
import { it } from "node:test";
import { AdamError } from "adam-core";
import { createPlaywrightSession } from "./playwright-session.ts";
import { snapshotFromHtml } from "./memory-session.ts";

it("cancels active navigation by closing only its tab and recovers the queue", async () => {
  const session = createPlaywrightSession();
  let entered!: () => void, rejectNavigation!: (error: Error) => void, finishClose!: () => void;
  const navigating = new Promise<void>((done) => { entered = done; });
  const blocked = new Promise<null>((_resolve, reject) => { rejectNavigation = reject; });
  const closeGate = new Promise<void>((done) => { finishClose = done; });
  const order: string[] = [];
  let ensures = 0;
  let firstClosed = false;
  // The holder's only tab: ADR 0045 opens a replacement before closing it.
  const context = {
    pages: () => (firstClosed ? [] : [first]),
    async newPage() { order.push("replacement.open"); return {}; },
  };
  const first = {
    isClosed: () => firstClosed,
    context: () => context,
    async goto() { order.push("first.goto"); entered(); return blocked; },
    async close() { order.push("first.close"); firstClosed = true; rejectNavigation(new Error("Target closed")); await closeGate; },
  };
  const second = {
    async goto() { order.push("second.goto"); return null; },
    async waitForFunction() {},
    async close() { assert.fail("the surviving read's tab must not close"); },
  };
  // Isolate the lifecycle from Chrome/OS/authentication. No browser is launched.
  Reflect.set(session, "ensurePage", async () => {
    const page = ++ensures === 1 ? first : second;
    Reflect.set(session, "page", page);
    return page;
  });
  Reflect.set(session, "rejectIfBlocked", async () => {});
  Reflect.set(session, "probeListing", async () => undefined);
  Reflect.set(session, "readSnapshot", async () => snapshotFromHtml("https://adam.unibas.ch/go/fold/100010", "Folder", "<main>This folder is empty</main>", "This folder is empty"));
  Reflect.set(session, "captureDebug", async () => {});
  const controller = new AbortController();
  const read = session.open("https://adam.unibas.ch/go/fold/100010", { signal: controller.signal });
  const cancelled = assert.rejects(read, (error: unknown) => error instanceof AdamError && error.code === "cancelled");
  await navigating;
  controller.abort();
  await cancelled;
  const next = session.open("https://adam.unibas.ch/go/fold/100010");
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(ensures, 1, "the queue must retain its slot until tab close finishes");
  finishClose();
  const recovered = await next;
  assert.equal(recovered.title, "Folder");
  assert.deepEqual(order, ["first.goto", "replacement.open", "first.close", "second.goto"]);
});
