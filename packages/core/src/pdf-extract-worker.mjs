import { parentPort, workerData } from "node:worker_threads";
// Node 20 lacks this promise helper. Keep the polyfill local to the parser worker.
if (!Promise.withResolvers) {
  Promise.withResolvers = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
}
// The display build avoids loading native canvas polyfills for text-only work.
const { getDocument } = await import("pdfjs-dist/build/pdf.mjs");

// Only local bytes enter this worker. No PDF scripts, XFA, rendering or remote URLs.
const task = getDocument({
  data: workerData.bytes,
  isEvalSupported: false,
  enableXfa: false,
  disableFontFace: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  verbosity: 0,
  stopAtErrors: true,
});
let result;
try {
  const document = await task.promise;
  const pages = [];
  let used = 0;
  let truncated = document.numPages > workerData.pagesLimit;
  for (let number = 1; number <= Math.min(document.numPages, workerData.pagesLimit); number++) {
    if (used >= workerData.charsLimit) { truncated = true; break; }
    const page = await document.getPage(number);
    const reader = page.streamTextContent().getReader();
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        for (const item of chunk.value.items) {
          if (!("str" in item)) continue;
          const part = `${item.str}${item.hasEOL ? "\n" : " "}`;
          const remaining = workerData.charsLimit - used;
          text += part.slice(0, remaining);
          used += Math.min(part.length, remaining);
          if (part.length > remaining) truncated = true;
        }
        if (used >= workerData.charsLimit) {
          truncated = true;
          await reader.cancel(new Error("Text extraction character limit reached."));
          break;
        }
      }
    } finally {
      reader.releaseLock();
      page.cleanup();
    }
    pages.push({ page: number, text });
  }
  result = { pages, pageCount: document.numPages, truncated };
} catch {
  // Parser diagnostics can contain document data; never return them to the host.
  result = { error: "unsupported_type" };
} finally {
  await task.destroy().catch(() => undefined);
}
parentPort.postMessage(result);
