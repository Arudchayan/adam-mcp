import { AdamError, MAX_EXTRACT_BYTES, throwIfCancelled } from "adam-core";
import { adamErrorFromAuthorizedHttpStatus } from "./upstream-errors.ts";
import type { AuthorizedFetchResult, AuthorizedProbeResult, AuthorizedStreamOptions } from "./session-types.ts";

type FetchHost = {
  origin: string;
  headers: (url: string) => Promise<Record<string, string>>;
  fetch?: typeof fetch;
  method?: "HEAD";
};

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
      const target = new URL(url);
      if (target.origin !== host.origin || target.protocol !== "https:") {
        throw new AdamError("unauthorized", "File retrieval left ADAM. Re-login before retrying.", false);
      }
      response = await request(target, { method: host.method, headers: await host.headers(target.href), redirect: "manual", signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        response = undefined;
        if (!location || redirects === 5) throw new AdamError("provider_unavailable", "ADAM file redirect limit exceeded.", false);
        url = new URL(location, target).href;
        continue;
      }
      if (!response.ok) throw adamErrorFromAuthorizedHttpStatus(response.status, "fetch");
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
      await options.onHeaders(metadata);
      const reader = response.body?.getReader();
      let size = 0;
      try {
        if (reader) {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            throwIfCancelled(signal);
            if (value.byteLength > options.maxBytes - size) throw tooLarge();
            await options.onChunk(value);
            size += value.byteLength;
          }
        }
      } finally {
        await reader?.cancel().catch(() => undefined);
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
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
  }
}
