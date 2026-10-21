import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Run release:check before this helper; release:prepare does that automatically.
// This creates review artifacts only. It never publishes or handles credentials.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".release");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm run release:prepare.");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
await mkdir(output, { recursive: true });
const [packed] = JSON.parse(execFileSync(process.execPath, [npmCli, "pack", "-w", "adam-mcp", "--pack-destination", output, "--json"], {
  cwd: root, encoding: "utf8", windowsHide: true,
}));
const sha256 = createHash("sha256").update(await readFile(join(output, packed.filename))).digest("hex");
const evidence = {
  createdAt: new Date().toISOString(),
  commit: git("rev-parse", "HEAD"),
  source: {
    commit: git("rev-parse", "HEAD"),
    archiveUrl: `https://github.com/Arudchayan/adam-mcp/archive/${git("rev-parse", "HEAD")}.tar.gz`,
    directions: "SOURCE.md",
  },
  dirty: git("status", "--porcelain").length > 0,
  node: process.version,
  npm: execFileSync(process.execPath, [npmCli, "--version"], { encoding: "utf8", windowsHide: true }).trim(),
  ciRun: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  package: { name: packed.name, version: packed.version, filename: packed.filename, integrity: packed.integrity, sha256, files: packed.files },
  registry: JSON.parse(await readFile(join(root, "server.json"), "utf8")),
  publicationApproved: false,
};
await writeFile(join(output, "release-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await writeFile(join(output, "SHA256SUMS"), `${sha256}  ${packed.filename}\n`);
console.error(`Prepared ${packed.filename} in .release/ with checksum and evidence. Publication still requires SECURITY.md sign-off.`);
if (evidence.dirty) console.error("Working tree has uncommitted changes; this artifact cannot identify a reviewed release commit.");
