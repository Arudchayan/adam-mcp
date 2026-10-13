import { AdamError, MAX_EXTRACT_BYTES, throwIfCancelled } from "adam-core";
import { adamErrorFromAuthorizedHttpStatus } from "./upstream-errors.ts";
import type { AuthorizedFetchResult } from "./session-types.ts";

type FetchHost = {
  origin: string;
  headers: (url: string) => Promise<Record<string, string>>;
  fetch?: typeof fetch;
};

/** Read only pinned-origin responses and cancel the stream at the byte boundary. */
export async function boundedAuthorizedFetch(url: string, host: FetchHost, signal?: AbortSignal): Promise<AuthorizedFetchResult> {
  throwIfCancelled(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 45_000);
  const request = host.fetch ?? fetch;
  let response: Response | undefined;
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const target = new URL(url);
      if (target.origin !== host.origin || target.protocol !== "https:") {
        throw new AdamError("unauthorized", "File retrieval left ADAM. Re-login before retrying.", false);
      }
      response = await request(target, { headers: await host.headers(target.href), redirect: "manual", signal: controller.signal });
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
      const tooLarge = () => new AdamError("provider_unavailable", `File is larger than the ${MAX_EXTRACT_BYTES} byte extract limit.`, false);
      if (contentLength !== undefined && contentLength > MAX_EXTRACT_BYTES) throw tooLarge();
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if (reader) {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value.byteLength > MAX_EXTRACT_BYTES - size) throw tooLarge();
            chunks.push(value);
            size += value.byteLength;
          }
        }
      } finally {
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
      }
      return {
        bytes: new Uint8Array(Buffer.concat(chunks, size)),
        contentType: response.headers.get("content-type") ?? undefined,
        contentDisposition: response.headers.get("content-disposition") ?? undefined,
        contentLength: size,
      };
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
