// Intentional reliability/test-fidelity failures, outside npm test discovery.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixtureProvider } from "adam-provider-fixture";
import { host } from "./mcp-harness.mjs";

test("R3: resource metadata validation matches the corresponding tool", async () => {
  const provider = createFixtureProvider();
  provider.getFile = async () => ({ type: "file", refId: "100011", title: 77, url: null, breadcrumb: [], provenance: {} });
  const rpc = await host(provider);
  try {
    const tool = await rpc.call("adam_get_file", { refId: "100011" });
    assert.equal(tool.result.isError, true);
    assert.equal(tool.result.structuredContent.error.code, "provider_unavailable");
    const resource = await rpc.resource("adam://file/100011");
    assert.ok(resource.error, "Malformed synthetic provider metadata should not become a successful resource");
  } finally { await rpc.close(); }
});

test("R4: fixture honors a denied type hint for an otherwise allowed identity", async () => {
  const rpc = await host(createFixtureProvider());
  try {
    const response = await rpc.call("adam_read_page", { refId: "adam://tst/100001", confirm: true });
    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.error.code, "unsupported_type");
  } finally { await rpc.close(); }
});

test("R5: resource cancellation reaches provider work", async () => {
  const provider = createFixtureProvider();
  const file = await provider.getFile("100011");
  let entered, release, signal;
  const started = new Promise((done) => { entered = done; });
  const blocked = new Promise((done) => { release = done; });
  provider.getFile = async (_id, options) => { signal = options?.signal; entered(); await blocked; return file; };
  const rpc = await host(provider);
  const response = rpc.resource("adam://file/100011");
  try {
    await started;
    await rpc.notify("notifications/cancelled", { requestId: 2, reason: "synthetic cancellation" });
    await new Promise((done) => setImmediate(done));
    assert.ok(signal instanceof AbortSignal, "Resource handler supplied no AbortSignal");
    assert.equal(signal.aborted, true);
  } finally { release(); await response; await rpc.close(); }
});
