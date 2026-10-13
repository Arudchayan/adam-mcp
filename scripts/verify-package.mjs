import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
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
  assert.ok(manifest.files.some((file) => file.path === "dist/pdf-extract-worker.mjs"));
  assert.ok(manifest.files.every((file) => /^(?:dist\/[^/]+\.mjs|README\.md|LICENSE|NOTICE|package\.json)$/.test(file.path)), "Package contains unexpected files.");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "adam-clean-consumer", private: true, type: "module" }));
  await npm(["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", join(temporary, manifest.filename)], consumer);
  const entry = join(consumer, "node_modules", "adam-mcp", "dist", "adam-mcp.mjs");
  const checked = await exec(process.execPath, [join(root, "scripts", "verify-dist.mjs"), entry], { cwd: consumer, env, windowsHide: true, timeout: 90_000 });
  process.stderr.write(checked.stderr);
  console.error("Fresh tarball installation with production dependencies verified; repository node_modules are outside its resolution path.");
} finally {
  assert.equal(resolve(dirname(temporary)), resolve(tmpdir()), "Refusing cleanup outside the temporary directory.");
  await rm(temporary, { recursive: true, force: true });
}
