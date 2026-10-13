import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the built package from outside the repository, including its PDF worker.
const entry = fileURLToPath(new URL("../packages/mcp/dist/adam-mcp.mjs", import.meta.url));
const env = { ...process.env, ADAM_MCP_TEST_FIXTURE: "1" };
delete env.ADAM_PROVIDER;
const child = spawn(process.execPath, [resolve(entry)], { cwd: tmpdir(), env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const pending = new Map();
let nextId = 0, buffered = "", failure;
child.stdout.setEncoding("utf8");
child.stderr.resume();
const fail = (error) => { failure = error; for (const item of pending.values()) item.reject(error); pending.clear(); };
child.once("error", fail);
child.once("exit", () => fail(new Error("Built server exited before completing verification.")));
child.stdout.on("data", (chunk) => {
  buffered += chunk;
  while (buffered.includes("\n")) {
    const newline = buffered.indexOf("\n");
    const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
    try {
      const message = JSON.parse(line);
      assert.equal(message.jsonrpc, "2.0", "stdout must contain only JSON-RPC");
      const item = pending.get(message.id);
      if (item) { pending.delete(message.id); item.resolve(message); }
    } catch (error) { fail(error); }
  }
});
async function request(method, params) {
  if (failure) throw failure;
  const id = ++nextId;
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => { pending.delete(id); reject(new Error(`Built server ${method} timed out.`)); }, 25_000);
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  } finally { clearTimeout(timer); }
}
try {
  const initialized = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "dist-check", version: "1" } });
  assert.ok(initialized.result);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const denied = await request("tools/call", { name: "adam_extract_file_text", arguments: { refId: "100011" } });
  assert.equal(denied.result.isError, true);
  const extracted = await request("tools/call", { name: "adam_extract_file_text", arguments: { refId: "100011", confirm: true } });
  assert.equal(extracted.result.isError, undefined);
  assert.equal(extracted.result.structuredContent.pages[0].page, 1);
  assert.ok(extracted.result.structuredContent.pages[0].text.trim());
  assert.equal("bytes" in extracted.result.structuredContent, false);
  if (failure) throw failure;
  console.error("Built stdio package and page-aware PDF worker verified outside the repository.");
} finally {
  child.kill();
}
