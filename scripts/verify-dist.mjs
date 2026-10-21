import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the built package from outside the repository, including its PDF worker.
const entry = process.argv[2] ?? fileURLToPath(new URL("../packages/mcp/dist/adam-mcp.mjs", import.meta.url));
const env = { ...process.env, ADAM_MCP_TEST_FIXTURE: "1" };
delete env.ADAM_PROVIDER;
delete env.NODE_PATH;
const help = spawnSync(process.execPath, [resolve(entry), "--help"], { cwd: tmpdir(), env, encoding: "utf8", windowsHide: true });
assert.equal(help.status, 0);
assert.equal(help.stdout, "");
assert.match(help.stderr, /Usage:/);
assert.match(help.stderr, /download FILE_ID/);

const diagnosticProfile = mkdtempSync(join(tmpdir(), "adam-dist-doctor-"));
try {
  const localEnv = { ...env, ADAM_BROWSER_PROFILE_DIR: diagnosticProfile };
  const downloadEnv = { ...localEnv };
  delete downloadEnv.ADAM_MCP_TEST_FIXTURE;
  const refused = spawnSync(process.execPath, [resolve(entry), "download", "100011", "--output-dir", diagnosticProfile], { cwd: tmpdir(), env: downloadEnv, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, "");
  assert.match(refused.stderr, /confirmation_required/);
  const setup = spawnSync(process.execPath, [resolve(entry), "setup", "--client", "codex"], { cwd: tmpdir(), env: localEnv, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(setup.status, 0, setup.stderr);
  assert.match(setup.stdout, /\[mcp_servers.adam\]/);
  assert.match(setup.stdout, /tool_timeout_sec = 2100/);
  assert.ok(setup.stdout.includes("adam-mcp.mjs"));
  const doctor = spawnSync(process.execPath, [resolve(entry), "doctor", "--json"], { cwd: tmpdir(), env: localEnv, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  const diagnosed = JSON.parse(doctor.stdout);
  assert.ok(diagnosed.checks.some((check) => check.name === "session" && check.state === "warning"));
  assert.ok(diagnosed.checks.some((check) => check.name === "server" && check.state === "pass"));
  assert.ok([0, 1].includes(doctor.status)); // Chrome need not be installed on CI.
} finally { rmSync(diagnosticProfile, { recursive: true, force: true }); }

async function verify(mode) {
const child = spawn(process.execPath, [resolve(entry)], { cwd: tmpdir(), env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const pending = new Map();
let nextId = 0, buffered = "", failure, cancelledId;
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
      if (cancelledId !== undefined) assert.notEqual(message.id, cancelledId, "cancelled modern requests must not receive a response");
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
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: withMeta(params) })}\n`);
    });
  } finally { clearTimeout(timer); }
}
function withMeta(params) {
  return mode === "modern" ? { ...params, _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  } } : params;
}
try {
  if (mode === "modern") {
    const discovered = await request("server/discover", {});
    assert.ok(discovered.result?.supportedVersions?.includes("2026-07-28"), JSON.stringify(discovered.error));
  } else {
    const initialized = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "dist-check", version: "1" } });
    assert.ok(initialized.result);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  }
  const tools = await request("tools/list", {});
  assert.ok(tools.result.tools.some((tool) => tool.name === "adam_extract_file_text"));
  const invalid = await request("tools/call", { name: "adam_list_news", arguments: { since: "not-a-date" } });
  assert.equal(invalid.result.isError, true);
  const whitespace = await request("tools/call", { name: "adam_search", arguments: { query: "   " } });
  assert.equal(whitespace.result.isError, true);
  const denied = await request("tools/call", { name: "adam_extract_file_text", arguments: { refId: "100011" } });
  assert.equal(denied.result.isError, true);
  const extracted = await request("tools/call", { name: "adam_extract_file_text", arguments: { refId: "100011", confirm: true } });
  assert.equal(extracted.result.isError, undefined);
  assert.equal(extracted.result.structuredContent.pages[0].page, 1);
  assert.ok(extracted.result.structuredContent.pages[0].text.trim());
  assert.equal("bytes" in extracted.result.structuredContent, false);
  const scoped = await request("tools/call", { name: "adam_search", arguments: { query: "Fourier", courseRefId: "100001", refresh: true } });
  assert.equal(scoped.result.isError, undefined);
  const outOfScope = await request("tools/call", { name: "adam_search", arguments: { query: "Fourier", courseRefId: "999999" } });
  assert.equal(outOfScope.result.isError, true);
  assert.equal(outOfScope.result.structuredContent.error.code, "forbidden");
  assert.deepEqual(Object.keys(outOfScope.result.structuredContent), ["error"]);
  if (mode === "modern") {
    cancelledId = ++nextId;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: cancelledId, method: "tools/call", params: withMeta({ name: "adam_extract_file_text", arguments: { refId: "100011", confirm: true } }) })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: withMeta({ requestId: cancelledId, reason: "distribution cancellation check" }) })}\n`);
    const recovered = await request("tools/call", { name: "adam_extract_file_text", arguments: { refId: "100011", confirm: true } });
    assert.ok(recovered.result.structuredContent.pages[0].text.trim());
  }
  if (failure) throw failure;
  console.error(`${mode} stdio and page-aware PDF worker verified outside the repository.`);
} finally {
  child.kill();
}
}
for (const mode of ["legacy", "modern"]) await verify(mode);
