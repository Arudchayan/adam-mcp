// Deliberately failing contract reproductions; not part of ordinary *.test.ts discovery.
// HTML and partial-response cases now reject before their historical success assertions;
// passing regression coverage lives in the ordinary core/browser test suites.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { it } from "node:test";
import { saveLocalDownload } from "../../../packages/provider-browser/src/local-download.ts";
import { boundedAuthorizedStream } from "../../../packages/provider-browser/src/bounded-fetch.ts";
import { chunks, deferred, file, origin, session, temporary } from "./support.ts";

for (const [label, bytes] of [
  ["UTF-16LE BOM", Buffer.concat([Buffer.from([255, 254]), Buffer.from("<!doctype html><html><body>Sign in</body></html>", "utf16le")])],
  ["1024 leading whitespace bytes", Buffer.from(" ".repeat(1024) + "<!doctype html><html><body>Sign in</body></html>")],
] as const) {
  it(`BUG HTML original is reported as successful binary download: ${label}`, async () => temporary(async (directory) => {
    const result = await saveLocalDownload(session(async () => new Response(chunks(bytes, 1), { headers: { "content-type": "application/octet-stream" } })), file, directory);
    assert.deepEqual(await readFile(result.path), bytes);
    console.error(JSON.stringify({ reproduction: label, actual: "saved HTML-shaped response", sizeBytes: result.sizeBytes }));
    assert.deepEqual(await readdir(directory), [], "Expected HTML-shaped response to be refused with no saved file");
  }));
}

it("BUG unsolicited HTTP 206 is published as a complete selected original", async () => temporary(async (directory) => {
  const result = await saveLocalDownload(session(async () => new Response("abc", {
    status: 206, headers: { "content-type": "application/octet-stream", "content-length": "3", "content-range": "bytes 0-2/100" },
  })), file, directory);
  assert.equal(await readFile(result.path, "utf8"), "abc");
  console.error(JSON.stringify({ reproduction: "unsolicited 206", actual: "successful completion", sizeBytes: result.sizeBytes, completeOriginalBytes: 100 }));
  assert.deepEqual(await readdir(directory), [], "Expected unsolicited partial content to be refused, not published as the original");
}));

it("BUG transfer timeout does not settle a pending credential callback", async () => {
  const entered = deferred(), release = deferred();
  let settled = false;
  const operation = boundedAuthorizedStream(`${origin}/synthetic`, {
    origin, headers: async () => { entered.resolve(); await release.promise; return {}; },
    fetch: async (_url, options) => { options?.signal?.throwIfAborted(); return new Response("abc"); },
  }, { maxBytes: 10, timeoutMs: 10, onHeaders: async () => {}, onChunk: async () => {} });
  const observed = operation.then(() => { settled = true; }, () => { settled = true; });
  await entered.promise;
  await new Promise((done) => setTimeout(done, 60));
  const settledBeforeRelease = settled;
  release.resolve(); await observed;
  console.error(JSON.stringify({ reproduction: "credential callback deadline", timeoutMs: 10, observedAfterMs: 60, settledBeforeRelease }));
  assert.equal(settledBeforeRelease, true, "Expected deadline to settle the operation without awaiting the credential callback");
});

it("BUG cancellation does not settle a pending sink callback", async () => {
  const entered = deferred(), release = deferred(), controller = new AbortController();
  let settled = false;
  const operation = boundedAuthorizedStream(`${origin}/synthetic`, {
    origin, headers: async () => ({}), fetch: async () => new Response("abc"),
  }, { signal: controller.signal, maxBytes: 10, timeoutMs: 1000, onHeaders: async () => {}, onChunk: async () => { entered.resolve(); await release.promise; } });
  const observed = operation.then(() => { settled = true; }, () => { settled = true; });
  await entered.promise; controller.abort();
  await new Promise((done) => setImmediate(done));
  const settledBeforeRelease = settled;
  release.resolve(); await observed;
  console.error(JSON.stringify({ reproduction: "sink callback cancellation", settledBeforeRelease }));
  assert.equal(settledBeforeRelease, true, "Expected cancellation to settle while a sink callback is blocked");
});
