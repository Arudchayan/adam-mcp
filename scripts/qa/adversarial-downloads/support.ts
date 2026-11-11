import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { boundedAuthorizedStream } from "../../../packages/provider-browser/src/bounded-fetch.ts";
import { createMemorySession } from "../../../packages/provider-browser/src/memory-session.ts";
import type { FileObject } from "../../../packages/core/src/types.ts";
import type { AdamBrowserSession } from "../../../packages/provider-browser/src/session-types.ts";

export const origin = "https://adam.unibas.ch";
export const file: FileObject = {
  refId: "100011", type: "file", title: "synthetic.bin", url: `${origin}/go/file/100011`,
  breadcrumb: [], provenance: { sourceUrl: `${origin}/go/file/100011`, fetchedAt: "2026-11-11T00:00:00Z", provider: "browser" },
};
export function session(fetch: typeof globalThis.fetch): AdamBrowserSession {
  return { ...createMemorySession({}), streamAuthorized: (url, options) => boundedAuthorizedStream(url, { origin, headers: async () => ({}), fetch }, options) };
}
export function chunks(bytes: Uint8Array, width: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(offset, offset + width)); offset = Math.min(bytes.length, offset + width);
  } });
}
export async function temporary(work: (directory: string) => Promise<void>) {
  const parent = await realpath(join(tmpdir(), "opencode"));
  const directory = await mkdtemp(join(parent, "adam-qa-downloads-"));
  try { await work(directory); } finally {
    assert.equal(resolve(dirname(directory)), resolve(parent));
    assert.ok(directory.startsWith(join(parent, "adam-qa-downloads-")));
    await rm(directory, { recursive: true, force: true });
  }
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
