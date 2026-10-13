import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { parse } from "smol-toml";
import { AdamError } from "adam-core";
import { hostEntry, installHostConfig, mergeHostConfig, renderHostConfig, TOOL_TIMEOUT_SECONDS } from "./host-config.ts";
import { diagnose } from "./doctor.ts";
import { parseSetupArgs } from "./setup-cli.ts";
import { fail } from "./results.ts";
import { paginatedObjectsOutputSchema, withToolErrors } from "./schemas.ts";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv";

it("uses absolute executable arguments with spaces and aligns the maximum login budget", () => {
  const entry = hostEntry("codex", join(tmpdir(), "My Courses", "ädam.mjs"));
  assert.equal(entry.command, process.execPath);
  assert.equal((entry.args as string[]).length, 1);
  const config = parse(renderHostConfig("codex", join(tmpdir(), "My Courses", "ädam.mjs")));
  const adam = (config.mcp_servers as Record<string, Record<string, unknown>>).adam!;
  assert.equal(adam.tool_timeout_sec, TOOL_TIMEOUT_SECONDS);
  assert.ok(TOOL_TIMEOUT_SECONDS > 30 * 60);
});

it("all JSON client formats preserve unrelated entries and use the expected stdio shape", () => {
  for (const client of ["cursor", "claude-desktop", "windsurf", "vscode"] as const) {
    const key = client === "vscode" ? "servers" : "mcpServers";
    const previous = JSON.stringify({ theme: "dark", [key]: { other: { command: "other" }, adam: { url: "https://example.invalid", env: { ADAM_BROWSER_PROFILE_DIR: "custom-profile" } } } });
    const config = JSON.parse(mergeHostConfig(client, previous, join(tmpdir(), "My Course", "adam.mjs")));
    assert.equal(config.theme, "dark");
    assert.equal(config[key].other.command, "other");
    assert.equal(config[key].adam.command, process.execPath);
    assert.equal(config[key].adam.url, undefined);
    assert.equal(config[key].adam.args.length, 1);
    assert.equal(config[key].adam.env.ADAM_BROWSER_PROFILE_DIR, "custom-profile");
    assert.equal(config[key].adam.type, client === "vscode" ? "stdio" : undefined);
    const preview = JSON.parse(renderHostConfig(client, join(tmpdir(), "My Course", "adam.mjs")));
    assert.equal(preview[key].adam.args.length, 1);
  }
});

it("preserves unrelated TOML settings and user tool policies while replacing old transport", () => {
  const original = 'model = "test-model"\nlarge = 9223372036854775807\nratio = 1.0\n[mcp_servers.other]\ncommand = "other"\n[mcp_servers.adam]\nurl = "https://example.invalid"\ntool_timeout_sec = 60\n[mcp_servers.adam.tools.adam_read_page]\napproval_mode = "prompt"\n';
  const config = parse(mergeHostConfig("codex", original, join(tmpdir(), "entry.mjs")), { integersAsBigInt: true });
  const servers = config.mcp_servers as Record<string, Record<string, unknown>>;
  assert.equal(config.model, "test-model");
  assert.equal(config.large, 9223372036854775807n);
  assert.equal(servers.other!.command, "other");
  assert.equal(servers.adam!.url, undefined);
  assert.equal(servers.adam!.tool_timeout_sec, BigInt(TOOL_TIMEOUT_SECONDS));
  assert.equal(((servers.adam!.tools as Record<string, Record<string, unknown>>).adam_read_page!).approval_mode, "prompt");
});

it("backs up existing JSON configuration, keeps other servers and refuses malformed files without echoing them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adam-setup-"));
  try {
    const target = join(dir, "config.json");
    const previous = '{"theme":"dark","mcpServers":{"other":{"command":"other"}}}';
    await writeFile(target, previous);
    const installed = await installHostConfig("cursor", target, join(dir, "My Course", "entry.mjs"));
    assert.equal(await readFile(installed.backup!, "utf8"), previous);
    const config = JSON.parse(await readFile(target, "utf8"));
    assert.equal(config.theme, "dark");
    assert.equal(config.mcpServers.other.command, "other");
    assert.equal(config.mcpServers.adam.args.length, 1);
    await writeFile(target, '{"password":"PRIVATE"');
    await assert.rejects(() => installHostConfig("cursor", target, "entry.mjs"), (error: unknown) => error instanceof AdamError && !error.message.includes("PRIVATE"));
    assert.equal(await readFile(target, "utf8"), '{"password":"PRIVATE"');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("diagnoses prerequisites and configuration without invoking login, navigation or mutating files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adam-doctor-"));
  try {
    const entry = join(dir, "entry.mjs"), config = join(dir, "config.toml");
    await writeFile(entry, "// synthetic entry");
    await writeFile(config, renderHostConfig("codex", entry));
    let probes = 0;
    const report = await diagnose(entry, { client: "codex", configPath: config, profileDir: dir, chrome: async () => true, session: async () => { probes++; return { loggedIn: false, connectionState: "signed-out" }; } });
    assert.equal(probes, 1);
    assert.equal(report.ready, true);
    assert.equal(report.checks.find((c) => c.name === "session")?.state, "warning");
    assert.equal(report.checks.find((c) => c.name === "client")?.state, "pass");
    assert.equal(await readFile(config, "utf8"), renderHostConfig("codex", entry));
    const missing = await diagnose(entry, { profileDir: dir, chrome: async () => false, session: async () => ({ loggedIn: false }) });
    assert.equal(missing.ready, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("setup previews by default and rejects ambiguous options", () => {
  assert.deepEqual(parseSetupArgs(["--client", "codex"]), { client: "codex", write: false, login: false, json: false });
  assert.throws(() => parseSetupArgs(["--client", "--write"]));
  assert.throws(() => parseSetupArgs(["--client", "unknown"]));
  assert.throws(() => parseSetupArgs(["--force"]));
});

it("errors expose actionable structured recovery and redact sensitive messages", () => {
  const response = fail(new AdamError("unauthorized", "password=PRIVATE"), "synthetic-run");
  const error = response.structuredContent!.error as Record<string, unknown>;
  assert.equal(error.code, "unauthorized");
  assert.equal(error.recoveryAction, "login");
  assert.equal(error.retryable, false);
  assert.equal(error.runId, "synthetic-run");
  assert.ok(!JSON.stringify(response).includes("PRIVATE"));
  assert.equal((fail(new Error("private failure")).structuredContent!.error as Record<string, unknown>).retryable, false);
});

it("advertised JSON output schemas validate real error envelopes and still reject malformed successes", () => {
  const schema = withToolErrors(paginatedObjectsOutputSchema)["~standard"].jsonSchema.output({ target: "draft-2020-12" });
  assert.equal(schema.type, "object");
  const validate = new AjvJsonSchemaValidator().getValidator(schema);
  assert.equal(validate(fail(new AdamError("forbidden", "No access.")).structuredContent).valid, true);
  assert.equal(validate({ items: "not an array" }).valid, false);
  assert.equal(validate({ error: { code: "forbidden" } }).valid, false);
  assert.equal(validate({ error: { code: "forbidden", message: "No access.", retryable: false, recoveryAction: "check_access_in_adam" }, text: "Unexpected content" }).valid, false);
});
