import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePackage = JSON.parse(await readFile(join(root, "packages/mcp/package.json"), "utf8"));
const registry = JSON.parse(await readFile(join(root, "server.json"), "utf8"));
assert.equal(registry.name, sourcePackage.mcpName, "MCP Registry ownership must match the npm package.");
assert.equal(registry.version, sourcePackage.version, "MCP Registry version must match the npm package.");
assert.equal(registry.packages.length, 1);
assert.equal(registry.packages[0].identifier, sourcePackage.name);
assert.equal(registry.packages[0].version, sourcePackage.version);
assert.equal(registry.packages[0].registryType, "npm");
assert.equal(registry.packages[0].transport.type, "stdio");
assert.equal(sourcePackage.private, undefined, "The CLI workspace must be publishable.");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this check through npm run test:package.");
const temporary = await mkdtemp(join(tmpdir(), "adam-package-"));
const consumer = join(temporary, "consumer");
const env = { ...process.env };
delete env.NODE_PATH;
async function npm(args, cwd) {
  return exec(process.execPath, [npmCli, ...args], { cwd, env, windowsHide: true, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
}
try {
  const packed = await npm(["pack", "-w", "adam-mcp", "--pack-destination", temporary, "--json"], root);
  const [manifest] = JSON.parse(packed.stdout);
  for (const required of ["dist/adam-mcp.mjs", "README.md", "LICENSE", "NOTICE", "SOURCE.md", "package.json"]) {
    assert.ok(manifest.files.some((file) => file.path === required), `Package is missing ${required}.`);
  }
  assert.ok(manifest.files.some((file) => file.path === "dist/pdf-extract-worker.mjs"));
  assert.ok(manifest.files.every((file) => /^(?:dist\/[^/]+\.mjs|README\.md|LICENSE|NOTICE|SOURCE\.md|package\.json)$/.test(file.path)), "Package contains unexpected files.");
  const revision = (await exec("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true })).stdout.trim();
  const sourceDirections = await readFile(join(root, "packages/mcp/SOURCE.md"), "utf8");
  assert.ok(sourceDirections.includes(`Source commit: ${revision}`));
  assert.ok(sourceDirections.includes(`https://github.com/Arudchayan/adam-mcp/archive/${revision}.tar.gz`));
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "adam-clean-consumer", private: true, type: "module" }));
  await npm(["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", join(temporary, manifest.filename)], consumer);
  const installed = JSON.parse(await readFile(join(consumer, "node_modules/adam-mcp/package.json"), "utf8"));
  assert.equal(installed.mcpName, registry.name);
  assert.equal(installed.version, sourcePackage.version);
  assert.match(installed.bin["adam-mcp"], /^(?:\.\/)?dist\/adam-mcp\.mjs$/);
  assert.equal(await readFile(join(consumer, "node_modules/adam-mcp/SOURCE.md"), "utf8"), sourceDirections);
  // The consumer resolves published dependency ranges without the repository lockfile.
  // Audit that dependency tree as well as the locked development workspace.
  const audited = await npm(["audit", "--omit=dev", "--audit-level=high"], consumer);
  process.stderr.write(audited.stdout);
  const entry = join(consumer, "node_modules", "adam-mcp", "dist", "adam-mcp.mjs");
  const checked = await exec(process.execPath, [join(root, "scripts", "verify-dist.mjs"), entry], { cwd: consumer, env, windowsHide: true, timeout: 90_000 });
  process.stderr.write(checked.stderr);
  console.error("Fresh tarball installation with production dependencies verified; repository node_modules are outside its resolution path.");
} finally {
  assert.equal(resolve(dirname(temporary)), resolve(tmpdir()), "Refusing cleanup outside the temporary directory.");
  await rm(temporary, { recursive: true, force: true });
}
