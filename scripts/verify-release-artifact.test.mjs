import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyPublishedPackage } from "./published-package.mjs";

const script = new URL("./verify-release-artifact.mjs", import.meta.url);
test("publication accepts the approved artifact and refuses altered bytes, versions, source and dirty trees", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "adam-release-guard-"));
  try {
    await mkdir(join(temporary, ".release"));
    await mkdir(join(temporary, "packages", "mcp"), { recursive: true });
    const source = { name: "adam-mcp", version: "0.2.0", mcpName: "io.github.Arudchayan/adam-mcp" };
    await writeFile(join(temporary, "packages", "mcp", "package.json"), JSON.stringify(source));
    // Exercise the OIDC CLI-version boundary independently of the Node 22/24
    // test runner's bundled npm. Publication itself always uses the real CLI.
    const npmFixture = join(temporary, "npm-version.mjs");
    await writeFile(npmFixture, 'process.stdout.write("11.5.1\\n");');
    const bytes = Buffer.from("synthetic archive bytes; no registry or account access");
    const filename = "adam-mcp-0.2.0.tgz";
    await writeFile(join(temporary, ".release", filename), bytes);
    const original = { dirty: false, commit: "approved-source", package: { name: source.name, version: source.version, filename, sha256: createHash("sha256").update(bytes).digest("hex") }, registry: { name: source.mcpName, version: source.version, packages: [{ version: source.version }] } };
    original.source = { commit: original.commit, archiveUrl: `https://github.com/Arudchayan/adam-mcp/archive/${original.commit}.tar.gz`, directions: "SOURCE.md" };
    const env = { ...process.env, npm_execpath: npmFixture, GITHUB_SHA: "approved-source", GITHUB_REF: "refs/heads/main", RELEASE_VERSION: source.version };
    const check = async (evidence, overrides = {}) => {
      await writeFile(join(temporary, ".release", "release-evidence.json"), JSON.stringify(evidence));
      return spawnSync(process.execPath, [fileURLToPath(script)], { cwd: temporary, env: { ...env, ...overrides }, encoding: "utf8", windowsHide: true });
    };
    const approved = await check(original);
    assert.equal(approved.status, 0, approved.stderr);
    for (const evidence of [{ ...original, dirty: true }, { ...original, commit: "another-source" }, { ...original, package: { ...original.package, sha256: "altered" } }]) {
      assert.notEqual((await check(evidence)).status, 0);
    }
    assert.notEqual((await check(original, { RELEASE_VERSION: "9.9.9" })).status, 0);
    assert.notEqual((await check({ ...original, source: { ...original.source, commit: "unrelated" } })).status, 0);
    assert.notEqual((await check({ ...original, source: { ...original.source, archiveUrl: "https://example.com/source" } })).status, 0);
    assert.notEqual((await check(original, { GITHUB_REF: "refs/heads/unreviewed" })).status, 0);
    await writeFile(npmFixture, 'process.stdout.write("11.5.0\\n");');
    assert.notEqual((await check(original)).status, 0, "An npm version below the OIDC minimum must fail.");
    await writeFile(npmFixture, 'process.stdout.write("11.5.1\\n");');
    await writeFile(join(temporary, ".release", filename), "tampered archive");
    assert.notEqual((await check(original)).status, 0);
  } finally {
    assert.equal(resolve(dirname(temporary)), resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  }
});

const expected = { integrity: "sha512-reviewed", mcpName: "io.github.test/server" };
const visible = () => Response.json({ dist: { integrity: expected.integrity }, mcpName: expected.mcpName });
test("published verification waits for registry propagation without republishing", async () => {
  let requests = 0, waits = 0;
  await verifyPublishedPackage("https://registry.npmjs.org/example/1.0.0", expected, {
    request: async () => ++requests < 3 ? new Response(null, { status: 404 }) : visible(),
    wait: async () => { waits++; }, maxAttempts: 3,
  });
  assert.equal(requests, 3); assert.equal(waits, 2);
});

test("published verification tolerates temporary server/network failures", async () => {
  let requests = 0;
  await verifyPublishedPackage("https://registry.npmjs.org/example/1.0.0", expected, {
    request: async () => { if (++requests === 1) throw new TypeError("synthetic network failure"); return requests === 2 ? new Response(null, { status: 503 }) : visible(); },
    wait: async () => {}, maxAttempts: 3,
  });
  assert.equal(requests, 3);
});

test("published integrity and authentication failures are never retried", async () => {
  for (const response of [new Response(null, { status: 403 }), Response.json({ dist: { integrity: "sha512-changed" }, mcpName: expected.mcpName })]) {
    let requests = 0;
    await assert.rejects(verifyPublishedPackage("https://registry.npmjs.org/example/1.0.0", expected, {
      request: async () => { requests++; return response; }, wait: async () => assert.fail("must not retry"),
    }));
    assert.equal(requests, 1);
  }
});

test("published lookup has both an attempt bound and elapsed deadline", async () => {
  let requests = 0;
  await assert.rejects(verifyPublishedPackage("https://registry.npmjs.org/example/1.0.0", expected, {
    request: async () => { requests++; return new Response(null, { status: 404 }); }, wait: async () => {}, maxAttempts: 2,
  }), /do not republish/);
  assert.equal(requests, 2);
  let time = 0;
  requests = 0;
  await assert.rejects(verifyPublishedPackage("https://registry.npmjs.org/example/1.0.0", expected, {
    request: async () => { requests++; return new Response(null, { status: 404 }); }, clock: () => time,
    wait: async (ms) => { time += ms; }, maxWaitMs: 10, retryDelayMs: 10,
  }), /lookup budget/);
  assert.equal(requests, 1);
});
