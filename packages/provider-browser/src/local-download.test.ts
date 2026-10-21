import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { createMemorySession } from "./memory-session.ts";
import { boundedAuthorizedStream } from "./bounded-fetch.ts";
import { downloadDirectory, MAX_DOWNLOAD_BYTES, safeDownloadFilename, saveLocalDownload } from "./local-download.ts";
import { parseDownloadArgs, runDownloadCli } from "./download-cli.ts";
import { createBrowserProvider } from "./browser-provider.ts";
import type { FileObject } from "adam-core";
import type { AdamBrowserSession } from "./session-types.ts";

const file: FileObject = { refId: "100011", type: "file", title: "Notes.pdf", url: "https://adam.unibas.ch/go/file/100011", breadcrumb: [], provenance: { sourceUrl: "https://adam.unibas.ch/go/file/100011", fetchedAt: "2026-10-21T00:00:00Z", provider: "browser" } };
const origin = "https://adam.unibas.ch";
function session(fetch: typeof globalThis.fetch): AdamBrowserSession {
  return { ...createMemorySession({}), streamAuthorized: (url, options) => boundedAuthorizedStream(url, { origin, headers: async () => ({}), fetch }, options) };
}
async function temporary(work: (directory: string) => Promise<void>) {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, "adam-download-test-"));
  try { await work(directory); } finally {
    assert.equal(resolve(dirname(directory)), resolve(parent));
    await rm(directory, { recursive: true, force: true });
  }
}

it("saves a streamed selected file with digest, server filename, no bytes result and collision protection", async () => temporary(async (directory) => {
  const bytes = Buffer.from("%PDF-synthetic download bytes");
  const authenticated = session(async (url) => {
    assert.equal(String(url), `${origin}/goto_adam_file_100011_download.html`);
    return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename*=UTF-8''%C3%9Cbungen.pdf" } });
  });
  await writeFile(join(directory, "Übungen.pdf"), "existing");
  const result = await saveLocalDownload(authenticated, file, directory);
  assert.equal(result.path, join(directory, "Übungen (1).pdf"));
  assert.deepEqual(await readFile(result.path), bytes);
  assert.equal(await readFile(join(directory, "Übungen.pdf"), "utf8"), "existing");
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.sizeBytes, bytes.byteLength);
  assert.equal(result.url, file.url);
  assert.equal("bytes" in result, false);
  assert.equal((await readdir(directory)).length, 2);
}));

it("accepts files over the extraction cap while preserving download limits", async () => temporary(async (directory) => {
  const bytes = new Uint8Array(8 * 1024 * 1024 + 1).fill(42);
  const result = await saveLocalDownload(session(async () => new Response(bytes)), file, directory);
  assert.equal(result.sizeBytes, bytes.byteLength);
}));

it("concurrent saves publish distinct complete files without overwriting", async () => temporary(async (directory) => {
  const bytes = Buffer.from("%PDF-concurrent original");
  const authenticated = session(async () => new Response(bytes));
  const results = await Promise.all([saveLocalDownload(authenticated, file, directory), saveLocalDownload(authenticated, file, directory)]);
  assert.notEqual(results[0].path, results[1].path);
  for (const result of results) assert.deepEqual(await readFile(result.path), bytes);
  assert.equal((await readdir(directory)).length, 2);
}));

it("refuses a cancelled selection and missing/file destinations before any transfer", async () => temporary(async (directory) => {
  const authenticated = session(async () => assert.fail("refused selection must not fetch"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(saveLocalDownload(authenticated, file, directory, controller.signal), /cancelled/);
  await assert.rejects(saveLocalDownload(authenticated, file, join(directory, "missing")));
  await writeFile(join(directory, "occupied"), "preserve");
  await assert.rejects(saveLocalDownload(authenticated, file, join(directory, "occupied")), /existing directory/);
  assert.deepEqual(await readdir(directory), ["occupied"]);
}));

for (const kind of ["declared_size", "stream_size", "html_mime", "split_html", "empty", "failure", "cancel"] as const) {
  it(`cleans temporary and final files on ${kind}`, async () => temporary(async (directory) => {
    const controller = new AbortController();
    const authenticated = session(async (_url, options) => {
      if (kind === "declared_size") return new Response("x", { headers: { "content-length": String(MAX_DOWNLOAD_BYTES + 1) } });
      if (kind === "html_mime") return new Response("login", { headers: { "content-type": "text/html" } });
      if (kind === "split_html") return new Response(new ReadableStream({ start(stream) { for (const text of ["<ht", "ml>Sign in</html>"]) stream.enqueue(Buffer.from(text)); stream.close(); } }));
      if (kind === "empty") return new Response(null);
      let sent = 0;
      return new Response(new ReadableStream({
        start(stream) { options?.signal?.addEventListener("abort", () => stream.error(new DOMException("Aborted", "AbortError")), { once: true }); },
        pull(stream) {
          if (kind === "stream_size") { stream.enqueue(new Uint8Array(1024 * 1024)); return; }
          if (!sent++) { stream.enqueue(Buffer.from("%PDF-first chunk")); return; }
          if (kind === "cancel") controller.abort();
          else stream.error(new Error("Synthetic transfer failure"));
        },
      }));
    });
    await assert.rejects(saveLocalDownload(authenticated, file, directory, controller.signal));
    assert.deepEqual(await readdir(directory), []);
  }));
}

it("rejects Git destinations, including worktree .git files, before fetching", async () => temporary(async (directory) => {
  await writeFile(join(directory, ".git"), "gitdir: synthetic");
  const nested = join(directory, "nested"); await mkdir(nested);
  await assert.rejects(saveLocalDownload(session(async () => assert.fail("fetch must not run")), file, nested), /outside a Git checkout/);
  await assert.rejects(downloadDirectory(join(directory, ".git")), /existing directory/);
}));

it("sanitizes traversal, reserved names, controls and long Unicode filenames", () => {
  assert.equal(safeDownloadFilename("../../CON.pdf", "1"), "_CON.pdf");
  assert.equal(safeDownloadFilename("..\\..\\NUL.txt", "1"), "_NUL.txt");
  assert.equal(safeDownloadFilename("COM¹.pdf", "1"), "_COM¹.pdf");
  assert.equal(safeDownloadFilename("bad\x00file?.pdf. ", "1"), "bad_file_.pdf");
  assert.equal(safeDownloadFilename("...", "1"), "file-1");
  assert.ok(Buffer.byteLength(safeDownloadFilename("界".repeat(300) + ".pdf", "1")) <= 180);
});

it("requires selected file, explicit destination and confirmation before creating a session", async () => {
  assert.deepEqual(parseDownloadArgs([file.url, "--output-dir", "D:/Study", "--confirm"]), { refId: file.refId, directory: "D:/Study" });
  for (const args of [[], ["100011"], ["100011", "--output-dir", "x"], ["100011", "--output-dir", "x", "--confirm", "--wat"], ["https://example.org/go/file/100011", "--output-dir", "x", "--confirm"], ["https://adam.unibas.ch/go/tst/100011", "--output-dir", "x", "--confirm"]]) {
    await assert.rejects(runDownloadCli(args, () => assert.fail("invalid input must not create a session")));
  }
});

it("closes the CLI provider and removes signal handlers after failure", async () => {
  let closed = 0;
  const listeners = process.listenerCount("SIGINT");
  await assert.rejects(runDownloadCli(["100011", "--output-dir", "synthetic", "--confirm"], () => ({
    async downloadFile() { throw new Error("Synthetic refusal"); }, async close() { closed++; },
  })), /Synthetic refusal/);
  assert.equal(closed, 1); assert.equal(process.listenerCount("SIGINT"), listeners);
});

it("downloads through provider file resolution and refuses explicit logout before transfer", async () => temporary(async (directory) => {
  const bytes = Buffer.from("%PDF-selected synthetic file");
  const memory = createMemorySession({}, {
    openError: () => new Error("Download is starting"),
    files: { [`${origin}/goto_adam_file_100011_download.html`]: { bytes, contentType: "application/pdf", contentDisposition: 'attachment; filename="Selected.pdf"' } },
  });
  let loggedOut = false, transfers = 0;
  const streaming = session(async () => { transfers++; return new Response(bytes); });
  const provider = createBrowserProvider({ session: { ...memory, streamAuthorized: streaming.streamAuthorized, explicitlyLoggedOut: async () => loggedOut } });
  const result = await provider.downloadFile(file.refId, directory);
  assert.equal(result.path, join(directory, "Selected.pdf"));
  assert.deepEqual(await readFile(result.path), bytes);
  loggedOut = true;
  await assert.rejects(provider.downloadFile(file.refId, directory), /explicitly logged out/);
  assert.equal(transfers, 1);
  await provider.close();
}));
