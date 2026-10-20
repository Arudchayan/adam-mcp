import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = new URL("./verify-release-artifact.mjs", import.meta.url);
test("publication accepts the approved artifact and refuses altered bytes, versions, source and dirty trees", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "adam-release-guard-"));
  try {
    await mkdir(join(temporary, ".release"));
    await mkdir(join(temporary, "packages", "mcp"), { recursive: true });
    const source = { name: "adam-mcp", version: "0.2.0", mcpName: "io.github.Arudchayan/adam-mcp" };
    await writeFile(join(temporary, "packages", "mcp", "package.json"), JSON.stringify(source));
    const bytes = Buffer.from("synthetic archive bytes; no registry or account access");
    const filename = "adam-mcp-0.2.0.tgz";
    await writeFile(join(temporary, ".release", filename), bytes);
    const original = { dirty: false, commit: "approved-source", package: { name: source.name, version: source.version, filename, sha256: createHash("sha256").update(bytes).digest("hex") }, registry: { name: source.mcpName, version: source.version, packages: [{ version: source.version }] } };
    const env = { ...process.env, GITHUB_SHA: "approved-source", GITHUB_REF: "refs/heads/main", RELEASE_VERSION: source.version };
    const check = async (evidence, overrides = {}) => {
      await writeFile(join(temporary, ".release", "release-evidence.json"), JSON.stringify(evidence));
      return spawnSync(process.execPath, [fileURLToPath(script)], { cwd: temporary, env: { ...env, ...overrides }, encoding: "utf8", windowsHide: true });
    };
    assert.equal((await check(original)).status, 0);
    for (const evidence of [{ ...original, dirty: true }, { ...original, commit: "another-source" }, { ...original, package: { ...original.package, sha256: "altered" } }]) {
      assert.notEqual((await check(evidence)).status, 0);
    }
    assert.notEqual((await check(original, { RELEASE_VERSION: "9.9.9" })).status, 0);
    assert.notEqual((await check(original, { GITHUB_REF: "refs/heads/unreviewed" })).status, 0);
    await writeFile(join(temporary, ".release", filename), "tampered archive");
    assert.notEqual((await check(original)).status, 0);
  } finally {
    assert.equal(resolve(dirname(temporary)), resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  }
});
