import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { boundedAuthorizedStream } from "../../../packages/provider-browser/src/bounded-fetch.ts";
import { downloadDirectory, safeDownloadFilename, saveLocalDownload } from "../../../packages/provider-browser/src/local-download.ts";
import { runDownloadCli } from "../../../packages/provider-browser/src/download-cli.ts";
import { WeightedQueue } from "../../../packages/core/src/weighted-queue.ts";
import { extractPdfText } from "../../../packages/core/src/pdf-extract.ts";
import { chunks, deferred, file, origin, session, temporary } from "./support.ts";

it("same binary is preserved across 1, 2, 7, 1023 and 4096-byte chunk boundaries", async () => temporary(async (directory) => {
  const bytes = Buffer.from(Array.from({ length: 4097 }, (_, index) => index % 256));
  for (const width of [1, 2, 7, 1023, 4096]) {
    const result = await saveLocalDownload(session(async () => new Response(chunks(bytes, width))), file, directory);
    assert.deepEqual(await readFile(result.path), bytes);
    assert.equal(result.sizeBytes, bytes.length);
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
  assert.equal((await readdir(directory)).length, 5);
}));

it("split UTF-8 BOM and case-insensitive HTML MIME are refused with cleanup", async () => temporary(async (directory) => {
  for (const mime of ["application/octet-stream", "Text/HTML; charset=utf-8", "application/xhtml+xml"]) {
    const bytes = Buffer.from("\ufeff<!DOCTYPE html><HTML><body>synthetic login</body></HTML>");
    await assert.rejects(saveLocalDownload(session(async () => new Response(chunks(bytes, 1), { headers: { "content-type": mime } })), file, directory));
    assert.deepEqual(await readdir(directory), []);
  }
}));

it("zero, exact-limit and over-limit stream boundaries; chunked overflow cancels before sink", async () => {
  for (const size of [0, 16, 17]) {
    let accepted = 0, cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(stream) {
      stream.enqueue(new Uint8Array(size)); if (size <= 16) stream.close();
    }, cancel() { cancelled = true; } });
    const operation = boundedAuthorizedStream(`${origin}/synthetic`, { origin, headers: async () => ({}), fetch: async () => new Response(body) }, {
      maxBytes: 16, timeoutMs: 1000, onHeaders: async () => {}, onChunk: async (chunk) => { accepted += chunk.length; },
    });
    if (size > 16) { await assert.rejects(operation, /byte download limit/); assert.equal(accepted, 0); assert.equal(cancelled, true); }
    else { await operation; assert.equal(accepted, size); }
  }
});

it("truncation and Content-Length overflow never publish or leave partial files", async () => temporary(async (directory) => {
  for (const length of [2, 4]) {
    await assert.rejects(saveLocalDownload(session(async () => new Response("abc", { headers: { "content-length": String(length) } })), file, directory), /unexpected byte count/);
    assert.deepEqual(await readdir(directory), []);
  }
}));

it("off-origin/scheme/port redirects are rejected before a second credential lookup", async () => {
  for (const location of ["https://adam.unibas.ch.evil.invalid/x", "//evil.invalid/x", "http://adam.unibas.ch/x", "https://adam.unibas.ch:444/x", "https://adam.unibas.ch@evil.invalid/x", "data:text/plain,abc"]) {
    let credentials = 0, requests = 0;
    await assert.rejects(boundedAuthorizedStream(`${origin}/synthetic`, {
      origin, headers: async () => { credentials++; return { Cookie: "synthetic=never-real" }; },
      fetch: async () => { requests++; return new Response(null, { status: 302, headers: { location } }); },
    }, { maxBytes: 16, timeoutMs: 1000, onHeaders: async () => {}, onChunk: async () => {} }), /left ADAM/);
    assert.equal(credentials, 1); assert.equal(requests, 1);
  }
});

it("redirect loops stop after six same-origin requests and cancel redirect bodies", async () => {
  let requests = 0, cancellations = 0;
  await assert.rejects(boundedAuthorizedStream(`${origin}/synthetic`, {
    origin, headers: async () => ({}), fetch: async () => {
      requests++;
      return new Response(new ReadableStream({ cancel() { cancellations++; } }), { status: 307, headers: { location: "/synthetic" } });
    },
  }, { maxBytes: 16, timeoutMs: 1000, onHeaders: async () => {}, onChunk: async () => {} }), /redirect limit/);
  assert.equal(requests, 6); assert.equal(cancellations, 6);
});

it("sink failure cancels source and no second chunk enters sink", async () => {
  let cancelled = false, writes = 0;
  const body = new ReadableStream<Uint8Array>({ pull(stream) { stream.enqueue(Buffer.from("abc")); }, cancel() { cancelled = true; } });
  await assert.rejects(boundedAuthorizedStream(`${origin}/synthetic`, { origin, headers: async () => ({}), fetch: async () => new Response(body) }, {
    maxBytes: 16, timeoutMs: 1000, onHeaders: async () => {}, onChunk: async () => { writes++; throw new Error("synthetic disk error"); },
  }), /synthetic disk error/);
  assert.equal(writes, 1); assert.equal(cancelled, true);
});

it("filename sanitization bounds traversal, ADS, devices, Unicode controls and long extensions", () => {
  for (const raw of ["../../CON.pdf", "..\\AUX.txt", "NUL", "PRN.log", "COM0.txt", "LPT9", "COM¹.txt", "x:y:$DATA", "x\u202efile.pdf", "x\u2066file", "x\x01file", ".".repeat(10), "界".repeat(1000) + "." + "字".repeat(100), "CON." + "x".repeat(100)]) {
    const name = safeDownloadFilename(raw, file.refId);
    assert.ok(name.length > 0);
    assert.ok(Buffer.byteLength(name) <= 180);
    assert.doesNotMatch(name, /[<>:"/\\|?*\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/);
    assert.doesNotMatch(name, /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i);
    assert.doesNotMatch(name, /[. ]$/);
  }
});

it("junction into a Git worktree is rejected after realpath resolution", async () => temporary(async (directory) => {
  const repository = join(directory, "repository"), alias = join(directory, "alias");
  await mkdir(repository); await writeFile(join(repository, ".git"), "gitdir: synthetic");
  await symlink(repository, alias, "junction");
  await assert.rejects(downloadDirectory(alias), /outside a Git checkout/);
}));

it("existing directory/junction collision targets remain intact", async () => temporary(async (directory) => {
  const output = join(directory, "output"), target = join(directory, "target");
  await mkdir(output); await mkdir(target); await writeFile(join(target, "sentinel"), "preserve");
  await symlink(target, join(output, file.title), "junction");
  await mkdir(join(output, "synthetic (1).bin"));
  const result = await saveLocalDownload(session(async () => new Response("abc")), file, output);
  assert.equal(result.path, join(output, "synthetic (2).bin"));
  assert.equal(await readFile(join(target, "sentinel"), "utf8"), "preserve");
  assert.equal((await readdir(output)).length, 3);
}));

it("missing temporary name at hard-link publication fails without a final file", async () => temporary(async (directory) => {
  const authenticated = session(async () => {
    const partials = await readdir(directory);
    assert.equal(partials.length, 1); assert.match(partials[0], /^\.adam-download-.*\.part$/);
    await unlink(join(directory, partials[0]));
    return new Response("abc");
  });
  await assert.rejects(saveLocalDownload(authenticated, file, directory), { code: "ENOENT" });
  assert.deepEqual(await readdir(directory), []);
}));

it("missing/duplicate/malformed confirmation never constructs the CLI provider", async () => {
  for (const args of [
    ["100011", "--output-dir", "unused"],
    ["100011", "--output-dir", "unused", "--confirm=false"],
    ["100011", "--output-dir", "unused", "--confirm", "--confirm"],
    ["100011", "--output-dir", "unused", "--confirm", "--output-dir", "second"],
    ["adam://tst/100011", "--output-dir", "unused", "--confirm"],
  ]) await assert.rejects(runDownloadCli(args, () => assert.fail("must not construct provider")));
});

it("PDF queue bounds count and waiting bytes, frees cancelled weight, and serializes failures", async () => {
  const queue = new WeightedQueue({ maxPending: 2, maxBytes: 8, waitMs: 1000 });
  const release = deferred(), controller = new AbortController();
  const active = queue.enqueue(8, () => release.promise);
  const queued = queue.enqueue(8, async () => assert.fail("cancelled work must not run"), controller.signal);
  await assert.rejects(queue.enqueue(1, async () => {}), /queue is full/);
  controller.abort(); await assert.rejects(queued, /cancelled/);
  const second = queue.enqueue(4, async () => { throw new Error("synthetic worker failure"); });
  const secondObserved = assert.rejects(second, /synthetic worker failure/);
  const third = queue.enqueue(4, async () => "survived");
  await assert.rejects(queue.enqueue(0, async () => {}), /queue is full/);
  release.resolve(); await active; await secondObserved; assert.equal(await third, "survived");
});

it("PDF queue wait deadline removes an entry and recovers capacity", async () => {
  const queue = new WeightedQueue({ maxPending: 1, maxBytes: 8, waitMs: 10 });
  const release = deferred(); const active = queue.enqueue(8, () => release.promise);
  await assert.rejects(queue.enqueue(8, async () => assert.fail("expired work must not run")), /queue wait exceeded/);
  const next = queue.enqueue(8, async () => "recovered");
  release.resolve(); await active; assert.equal(await next, "recovered");
});

it("production PDF admission queue refuses a ninth waiter and cancels before worker spawn", async () => {
  const controllers = Array.from({ length: 10 }, () => new AbortController());
  const operations = controllers.map((controller) => {
    try { return extractPdfText(Buffer.from("%PDF-1.7\nsynthetic invalid document"), 20, 40000, controller.signal); }
    catch (error) { return Promise.reject(error); }
  });
  const observed = operations.map((operation) => operation.then(() => "success", (error) => error.message));
  for (const controller of controllers) controller.abort();
  const results = await Promise.all(observed);
  assert.match(results[9], /queue is full/);
  assert.ok(results.slice(0, 9).every((message) => /cancelled/.test(message)));
});

it("production PDF queue permits only 32 MiB of waiting input in addition to the active input", async () => {
  await new Promise((done) => setImmediate(done));
  const bytes = new Uint8Array(8 * 1024 * 1024);
  const controllers = Array.from({ length: 6 }, () => new AbortController());
  const operations = controllers.map((controller) => extractPdfText(bytes, 20, 40000, controller.signal));
  const observed = operations.map((operation) => operation.then(() => "success", (error) => error.message));
  for (const controller of controllers) controller.abort();
  const results = await Promise.all(observed);
  assert.match(results[5], /queue is full/);
  assert.ok(results.slice(0, 5).every((message) => /cancelled/.test(message)));
});
