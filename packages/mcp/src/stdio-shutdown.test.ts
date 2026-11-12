import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createFixtureProvider } from "adam-provider-fixture";
import { runStdio } from "./index.ts";
import { createAdamMcpServer } from "./server.ts";

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("stdio shutdown timed out")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("stdio EOF closes an active MCP connection and provider exactly once", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  let closes = 0;
  const provider = createFixtureProvider() as ReturnType<typeof createFixtureProvider> & { close(): Promise<void> };
  provider.close = async () => { closes++; };
  const sigintListeners = process.listenerCount("SIGINT");
  const sigtermListeners = process.listenerCount("SIGTERM");
  const serving = runStdio({ provider }, { stdin, stdout });

  stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"shutdown-test","version":"1"}}}\n');
  await withTimeout((async () => {
    while (!output.includes('"id":1')) await new Promise((resolve) => setImmediate(resolve));
  })());
  stdin.end();
  await withTimeout(serving);
  assert.equal(closes, 1);
  assert.equal(process.listenerCount("SIGINT"), sigintListeners);
  assert.equal(process.listenerCount("SIGTERM"), sigtermListeners);
});

test("malformed JSON is reported but does not shut down the stdio server", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  let closes = 0;
  const provider = createFixtureProvider() as ReturnType<typeof createFixtureProvider> & { close(): Promise<void> };
  provider.close = async () => { closes++; };
  const serving = runStdio({ provider }, { stdin, stdout });
  stdin.write('{}\n');
  stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"malformed-then-valid","version":"1"}}}\n');
  await withTimeout((async () => {
    while (!output.includes('"id":1')) await new Promise((resolve) => setImmediate(resolve));
  })());
  assert.equal(closes, 0);
  stdin.end();
  await withTimeout(serving);
  assert.equal(closes, 1);
});

test("provider cleanup waits for SDK product close on EOF", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  let releaseClose!: () => void;
  let closeStarted!: () => void;
  const closeGate = new Promise<void>((resolve) => { releaseClose = resolve; });
  const started = new Promise<void>((resolve) => { closeStarted = resolve; });
  let providerCloses = 0;
  const provider = createFixtureProvider() as ReturnType<typeof createFixtureProvider> & { close(): Promise<void> };
  provider.close = async () => { providerCloses++; };
  const serving = runStdio({ provider }, { stdin, stdout }, undefined, () => {
    const server = createAdamMcpServer({ provider });
    const close = server.close.bind(server);
    server.close = async () => { closeStarted(); await closeGate; await close(); };
    return server;
  });
  stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"close-order-test","version":"1"}}}\n');
  await withTimeout((async () => {
    while (!output.includes('"id":1')) await new Promise((resolve) => setImmediate(resolve));
  })());
  stdin.end();
  await withTimeout(started);
  assert.equal(providerCloses, 0);
  releaseClose();
  await withTimeout(serving);
  assert.equal(providerCloses, 1);
});

test("stdio stream failure still closes the provider and reports cleanup failure", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdout.resume();
  let closes = 0;
  const provider = createFixtureProvider() as ReturnType<typeof createFixtureProvider> & { close(): Promise<void> };
  provider.close = async () => { closes++; throw new Error("synthetic provider close failure"); };
  const serving = runStdio({ provider }, { stdin, stdout });
  stdin.destroy(new Error("synthetic transport failure"));
  await assert.rejects(withTimeout(serving), /synthetic provider close failure/);
  assert.equal(closes, 1);
});

test("stdio startup failure and provider cleanup failure are both handled", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let closes = 0;
  const provider = createFixtureProvider() as ReturnType<typeof createFixtureProvider> & { close(): Promise<void> };
  provider.close = async () => { closes++; throw new Error("synthetic provider cleanup failure"); };
  const failToServe = (() => { throw new Error("synthetic serve startup failure"); }) as typeof serveStdio;
  let unhandled: unknown;
  const onUnhandled = (error: unknown) => { unhandled = error; };
  process.on("unhandledRejection", onUnhandled);
  try {
  await assert.rejects(runStdio({ provider }, { stdin, stdout }, failToServe), /synthetic serve startup failure/);
  await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.equal(closes, 1);
  assert.equal(unhandled, undefined);
});

test("a child with an active MCP connection exits after EOF without a signal", async () => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const entry = new URL("./index.ts", import.meta.url).href;
  const script = `
    import { createFixtureProvider } from "adam-provider-fixture";
    import { runStdio } from ${JSON.stringify(entry)};
    const provider = createFixtureProvider();
    provider.close = async () => { process.stderr.write("SYNTHETIC_PROVIDER_CLOSED\\n"); };
    await runStdio({ provider });
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: packageRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"child-shutdown-test","version":"1"}}}\n');
  let exit: { code: number | null; signal: NodeJS.Signals | null };
  try {
    await withTimeout((async () => {
      while (!stdout.includes('"id":1')) await new Promise((resolve) => setTimeout(resolve, 10));
    })(), 30_000);
    child.stdin.end();
    exit = await withTimeout(new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }), 30_000);
  } catch (error) {
    child.kill("SIGKILL");
    child.unref();
    throw error;
  }
  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  assert.match(stderr, /SYNTHETIC_PROVIDER_CLOSED/);
});
