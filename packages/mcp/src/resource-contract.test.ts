import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixtureProvider } from "adam-provider-fixture";
import { SharedOperation } from "../../provider-browser/src/request-lifecycle.ts";
// The QA harness exercises real JSON-RPC resource handlers over the SDK transport.
// @ts-expect-error The JavaScript harness has no declaration file.
import { host } from "../../../scripts/qa/mcp-harness.mjs";

const cases = [
  ["listCourses", "adam://me/courses"],
  ["getCourse", "adam://crs/100001"],
  ["listChildren", "adam://fold/100020"],
  ["getFile", "adam://file/100011"],
  ["getExercise", "adam://exc/100021"],
  ["getForum", "adam://frm/100040"],
] as const;

test("resource success contracts reject malformed nested metadata and preserve valid envelopes", async () => {
  for (const [method, uri] of cases) {
    const provider = createFixtureProvider();
    const rpc = await host(provider);
    try {
      const valid = await rpc.resource(uri);
      assert.equal(valid.error, undefined, uri);
      const data = JSON.parse(valid.result.contents[0].text);
      assert.equal(data.untrusted, true);
      if (method === "getExercise") assert.ok(data.units.every((unit: Record<string, unknown>) => !("instructionText" in unit)));
      if (method === "getForum") assert.equal(data.selectedThread, undefined);
      const mutable = provider as unknown as Record<string, (...args: unknown[]) => Promise<any>>;
      const original = mutable[method]!.bind(provider);
      mutable[method] = async (...args) => {
        const value = await original(...args);
        if (method === "listCourses" || method === "listChildren") {
          const item = (await provider.getCourse("100001"));
          return { ...value, listingState: "ok", items: [{ ...item, provenance: {} }] };
        }
        return { ...value, provenance: {} };
      };
      const invalid = await rpc.resource(uri);
      assert.match(invalid.error?.message ?? "", /provider_unavailable:.*retryable=false/);
    } finally {
      await rpc.close();
    }
  }
});

test("cancelling a resource subscriber preserves another shared subscriber", async () => {
  const provider = createFixtureProvider();
  const file = await provider.getFile("100011");
  let release!: () => void;
  let entered!: () => void;
  let workSignal: AbortSignal | undefined;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const operation = new SharedOperation(async (signal) => {
    workSignal = signal;
    entered();
    await gate;
    return file;
  });
  let joins = 0;
  let bothJoined!: () => void;
  const joined = new Promise<void>((resolve) => { bothJoined = resolve; });
  provider.getFile = async (_id, options) => {
    const result = operation.join(options?.signal);
    if (++joins === 2) bothJoined();
    return result;
  };
  const rpc = await host(provider);
  const first = rpc.resource("adam://file/100011");
  await started;
  const second = rpc.resource("adam://file/100011");
  try {
    await joined;
    await rpc.notify("notifications/cancelled", { requestId: 2, reason: "test" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(workSignal?.aborted, false);
    release();
    assert.equal((await second).error, undefined);
  } finally {
    release();
    await first;
    await rpc.close();
  }
});

test("all resource requests forward the SDK cancellation signal", async () => {
  for (const [method, uri] of cases) {
    const provider = createFixtureProvider();
    const mutable = provider as unknown as Record<string, (...args: unknown[]) => Promise<any>>;
    const original = mutable[method]!.bind(provider);
    let signal: AbortSignal | undefined;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    mutable[method] = async (...args) => {
      signal = (args[method === "listCourses" ? 0 : 1] as { signal?: AbortSignal })?.signal;
      entered();
      await blocked;
      return original(...args);
    };
    const rpc = await host(provider);
    const pending = rpc.resource(uri);
    try {
      await started;
      await rpc.notify("notifications/cancelled", { requestId: 2, reason: "test" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(signal instanceof AbortSignal, uri);
      assert.equal(signal.aborted, true, uri);
    } finally {
      release();
      await pending;
      await rpc.close();
    }
  }
});
