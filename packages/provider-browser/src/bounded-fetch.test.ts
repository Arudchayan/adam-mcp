import assert from "node:assert/strict";
import { it } from "node:test";
import { AdamError, MAX_EXTRACT_BYTES } from "adam-core";
import { boundedAuthorizedFetch } from "./bounded-fetch.ts";

const origin = "https://adam.unibas.ch";
it("HEAD probes preserve large-file metadata without reading response bytes", async () => {
  let cancelled = false;
  const result = await boundedAuthorizedFetch(`${origin}/file`, {
    origin, method: "HEAD", headers: async () => ({}), fetch: async (_url, options) => {
      assert.equal(options?.method, "HEAD");
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        headers: { "content-length": String(MAX_EXTRACT_BYTES + 1), "content-type": "application/pdf" },
      });
    },
  });
  assert.equal(result.contentLength, MAX_EXTRACT_BYTES + 1);
  assert.equal(result.bytes.byteLength, 0);
  assert.equal(cancelled, true);
});

it("HEAD probes never follow off-origin redirects", async () => {
  let headers = 0;
  await assert.rejects(() => boundedAuthorizedFetch(`${origin}/file`, {
    origin, method: "HEAD", headers: async () => { headers++; return {}; },
    fetch: async () => new Response(null, { status: 302, headers: { location: "https://example.org/file" } }),
  }), (error: unknown) => error instanceof AdamError && error.code === "unauthorized");
  assert.equal(headers, 1);
});
it("rejects a declared oversized response before reading and cancels its stream", async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(() => boundedAuthorizedFetch(`${origin}/file`, {
    origin, headers: async () => ({}), fetch: async () => new Response(body, { headers: { "content-length": String(MAX_EXTRACT_BYTES + 1) } }),
  }), (error: unknown) => error instanceof AdamError && error.retryable === false);
  assert.equal(cancelled, true);
});
it("caps chunked responses without Content-Length and cancels before buffering the excess", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_EXTRACT_BYTES)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => boundedAuthorizedFetch(`${origin}/file`, {
    origin, headers: async () => ({}), fetch: async () => new Response(body),
  }), /byte extract limit/);
  assert.equal(cancelled, true);
});
it("accepts exact-limit data and retains metadata", async () => {
  const result = await boundedAuthorizedFetch(`${origin}/file`, {
    origin, headers: async () => ({}), fetch: async () => new Response(new Uint8Array(MAX_EXTRACT_BYTES), { headers: { "content-type": "application/pdf" } }),
  });
  assert.equal(result.bytes.byteLength, MAX_EXTRACT_BYTES);
  assert.equal(result.contentType, "application/pdf");
});
it("never fetches an off-origin redirect or sends it credentials", async () => {
  let requests = 0, headers = 0;
  await assert.rejects(() => boundedAuthorizedFetch(`${origin}/file`, {
    origin, headers: async () => { headers++; return { Cookie: "synthetic=value" }; },
    fetch: async () => { requests++; return new Response(null, { status: 302, headers: { location: "https://example.org/file" } }); },
  }), (error: unknown) => error instanceof AdamError && error.code === "unauthorized");
  assert.equal(requests, 1); assert.equal(headers, 1);
});
it("does not start a cancelled transfer", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => boundedAuthorizedFetch(`${origin}/file`, { origin, headers: async () => { throw new Error("must not run"); } }, controller.signal),
    (error: unknown) => error instanceof AdamError && error.code === "cancelled");
});

it("cancels a transfer while waiting for its next streamed chunk", async () => {
  const controller = new AbortController();
  const operation = boundedAuthorizedFetch(`${origin}/file`, {
    origin, headers: async () => ({}), fetch: async (_url, options) => {
      const body = new ReadableStream({ start(stream) {
        options?.signal?.addEventListener("abort", () => stream.error(new DOMException("Aborted", "AbortError")), { once: true });
      } });
      return new Response(body);
    },
  }, controller.signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(operation, (error: unknown) => error instanceof AdamError && error.code === "cancelled");
});
