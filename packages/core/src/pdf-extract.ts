import { Worker } from "node:worker_threads";
import { AdamError, throwIfCancelled } from "./errors.ts";

export type PdfText = {
  pages: Array<{ page: number; text: string }>;
  pageCount: number;
  truncated: boolean;
};

let busy = false;
const waiting: Array<() => void> = [];

/** Isolate parser memory, elapsed time and diagnostics from the stdio server. */
export function extractPdfText(bytes: Uint8Array, pagesLimit: number, charsLimit: number, signal?: AbortSignal): Promise<PdfText> {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const cancelWaiting = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) {
        waiting.splice(index, 1);
        reject(new AdamError("cancelled", "Queued PDF extraction cancelled.", false));
      }
    };
    const start = () => {
      signal?.removeEventListener("abort", cancelWaiting);
      busy = true;
      Promise.resolve().then(() => runPdfWorker(bytes, pagesLimit, charsLimit, signal))
        .then(resolve, reject)
        .finally(() => { busy = false; waiting.shift()?.(); });
    };
    if (busy) {
      waiting.push(start);
      signal?.addEventListener("abort", cancelWaiting, { once: true });
    } else start();
  });
}

function runPdfWorker(bytes: Uint8Array, pagesLimit: number, charsLimit: number, signal?: AbortSignal): Promise<PdfText> {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdf-extract-worker.mjs", import.meta.url), {
      workerData: { bytes: new Uint8Array(bytes), pagesLimit, charsLimit },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      stdout: true,
      stderr: true,
    });
    // Consume library diagnostics without exposing document contents or polluting stdout.
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (error?: Error, result?: PdfText) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate().then(() => {
        if (error) reject(error); else resolve(result!);
      }, () => reject(error ?? new AdamError("provider_unavailable", "PDF worker cleanup failed.", false)));
    };
    const abort = () => finish(new AdamError("cancelled", "PDF extraction cancelled.", false));
    const timer = setTimeout(() => finish(new AdamError("provider_unavailable", "PDF extraction exceeded the 20-second limit. Open it in ADAM instead.", false)), 20_000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    worker.once("message", (result: PdfText & { error?: string }) => {
      if (result.error) finish(new AdamError("unsupported_type", "This PDF has no extractable text or could not be parsed. Open it in ADAM instead.", false));
      else finish(undefined, result);
    });
    worker.once("error", () => finish(new AdamError("provider_unavailable", "PDF extraction failed within the parser resource limits. Open it in ADAM instead.", false)));
    worker.once("exit", () => finish(new AdamError("provider_unavailable", "PDF extraction ended without text. Open it in ADAM instead.", false)));
  });
}
