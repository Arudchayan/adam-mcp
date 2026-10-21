import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const evidence = JSON.parse(await readFile(".release/release-evidence.json", "utf8"));
const pkg = evidence.package;
assert.equal(pkg.name, "adam-mcp");
assert.match(pkg.filename, /^adam-mcp-\d+\.\d+\.\d+(?:-[\w.-]+)?\.tgz$/);
assert.equal(pkg.filename, `${pkg.name}-${pkg.version}.tgz`);
const source = JSON.parse(await readFile("packages/mcp/package.json", "utf8"));
assert.equal(source.version, pkg.version);
assert.equal(source.mcpName, evidence.registry.name);
assert.equal(evidence.dirty, false, "Publication requires a clean source checkout.");
assert.equal(evidence.commit, process.env.GITHUB_SHA, "Artifact must come from this workflow commit.");
assert.equal(evidence.source.commit, evidence.commit);
assert.equal(evidence.source.archiveUrl, `https://github.com/Arudchayan/adam-mcp/archive/${evidence.commit}.tar.gz`);
assert.equal(evidence.source.directions, "SOURCE.md");
assert.equal(evidence.registry.version, pkg.version);
assert.equal(evidence.registry.packages[0].version, pkg.version);
assert.equal(createHash("sha256").update(await readFile(`.release/${pkg.filename}`)).digest("hex"), pkg.sha256);
if (process.argv.includes("--published")) {
  const response = await fetch(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`);
  assert.ok(response.ok, `Published version lookup returned ${response.status}.`);
  const published = await response.json();
  assert.equal(published.dist.integrity, pkg.integrity);
  assert.equal(published.mcpName, evidence.registry.name);
  console.error("Published npm version and integrity match the reviewed artifact.");
} else {
  assert.equal(pkg.version, process.env.RELEASE_VERSION, "Requested version must match the tarball.");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  assert.ok(process.env.npm_execpath, "Run through npm run release:verify.");
  const npmVersion = execFileSync(process.execPath, [process.env.npm_execpath, "--version"], { encoding: "utf8" }).trim().split(".").map(Number);
  assert.ok(npmVersion[0] > 11 || (npmVersion[0] === 11 && (npmVersion[1] > 5 || (npmVersion[1] === 5 && npmVersion[2] >= 1))), "npm 11.5.1+ required for OIDC.");
  console.error("Approved source, version and tarball checksum verified.");
}
