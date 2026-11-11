import { AdamError, MAX_EXTRACT_BYTES, throwIfCancelled } from "adam-core";
import { adamErrorFromAuthorizedHttpStatus } from "./upstream-errors.ts";
import type { AuthorizedFetchResult, AuthorizedProbeResult, AuthorizedStreamOptions } from "./session-types.ts";

type FetchHost = {
  origin: string;
  headers: (url: string, signal: AbortSignal) => Promise<Record<string, string>>;
  fetch?: typeof fetch;
  method?: "HEAD";
};

// Only use for operations without sink side effects. Promise.race observes late
// rejections; its abort listener is removed regardless of the winner.
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Transfer aborted"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener("abort", abort); }
}

function cancelBody(body: ReadableStream<Uint8Array> | null | undefined): void {
  if (body && !body.locked) void body.cancel().catch(() => undefined);
}

/** Read only pinned-origin responses and cancel the stream at the byte boundary. */
export async function boundedAuthorizedFetch(url: string, host: FetchHost, signal?: AbortSignal): Promise<AuthorizedFetchResult> {
  const chunks: Uint8Array[] = [];
  const metadata = await boundedAuthorizedStream(url, host, {
    signal, maxBytes: MAX_EXTRACT_BYTES, timeoutMs: 45_000,
    onHeaders: async () => {}, onChunk: async (chunk) => { chunks.push(chunk); },
  });
  return { ...metadata, bytes: new Uint8Array(Buffer.concat(chunks)) };
}

/** Stream with backpressure and origin checks before credentials on every hop. */
export async function boundedAuthorizedStream(url: string, host: FetchHost, options: AuthorizedStreamOptions): Promise<AuthorizedProbeResult> {
  const signal = options.signal;
  throwIfCancelled(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs);
  const request = host.fetch ?? fetch;
  let response: Response | undefined;
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      controller.signal.throwIfAborted();
      const target = new URL(url);
      if (target.origin !== host.origin || target.protocol !== "https:") {
        throw new AdamError("unauthorized", "File retrieval left ADAM. Re-login before retrying.", false);
      }
      const headers = await abortable(host.headers(target.href, controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      const pending = request(target, { method: host.method, headers, redirect: "manual", signal: controller.signal });
      // A non-cooperative fetch may resolve after the caller has returned.
      void pending.then((late) => { if (controller.signal.aborted) cancelBody(late.body); }, () => {});
      response = await abortable(pending, controller.signal);
      controller.signal.throwIfAborted();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        cancelBody(response.body);
        response = undefined;
        if (!location || redirects === 5) throw new AdamError("provider_unavailable", "ADAM file redirect limit exceeded.", false);
        url = new URL(location, target).href;
        continue;
      }
      if (!response.ok) throw adamErrorFromAuthorizedHttpStatus(response.status, "fetch");
      if (response.status === 206 || response.headers.has("content-range")) {
        throw new AdamError("provider_unavailable", "ADAM returned partial file content; no complete file was received.", true);
      }
      const rawLength = response.headers.get("content-length");
      const contentLength = rawLength !== null && /^\d+$/.test(rawLength) ? Number(rawLength) : undefined;
      const metadata = {
        contentType: response.headers.get("content-type") ?? undefined,
        contentDisposition: response.headers.get("content-disposition") ?? undefined,
        contentLength,
      };
      if (host.method === "HEAD") {
        return metadata;
      }
      const tooLarge = () => new AdamError("provider_unavailable", `File is larger than the ${options.maxBytes} byte ${options.maxBytes === MAX_EXTRACT_BYTES ? "extract" : "download"} limit.`, false);
      if (contentLength !== undefined && contentLength > options.maxBytes) throw tooLarge();
      controller.signal.throwIfAborted();
      await options.onHeaders(metadata, controller.signal);
      controller.signal.throwIfAborted();
      const reader = response.body?.getReader();
      let size = 0;
      try {
        if (reader) {
          while (true) {
            const { value, done } = await abortable(reader.read(), controller.signal);
            controller.signal.throwIfAborted();
            if (done) break;
            throwIfCancelled(signal);
            if (value.byteLength > options.maxBytes - size) throw tooLarge();
            await options.onChunk(value, controller.signal);
            controller.signal.throwIfAborted();
            size += value.byteLength;
          }
        }
      } finally {
        if (reader) void reader.cancel().catch(() => undefined);
        reader?.releaseLock();
      }
      throwIfCancelled(signal);
      if (controller.signal.aborted) throw new Error("Transfer deadline reached");
      // Content-Length describes encoded bytes; decompressed streams can differ.
      if (!response.headers.get("content-encoding") && contentLength !== undefined && contentLength !== size) {
        throw new AdamError("provider_unavailable", "ADAM file transfer ended with an unexpected byte count. Retry the selected file.", true);
      }
      return { ...metadata, contentLength: size };
    }
    throw new AdamError("provider_unavailable", "ADAM file redirect limit exceeded.", false);
  } catch (error) {
    throwIfCancelled(signal);
    if (controller.signal.aborted) throw new AdamError("provider_unavailable", "ADAM file retrieval timed out.", true);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    cancelBody(response?.body);
  }
}
