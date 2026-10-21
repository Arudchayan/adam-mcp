import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = resolve(root, "packages/mcp");
const distDir = resolve(mcpDir, "dist");
const manifest = JSON.parse(readFileSync(resolve(mcpDir, "package.json"), "utf8"));
let sourceCommit;
try {
  sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
} catch {
  // A downloaded source archive has no .git directory. Its immutable revision
  // is given in SOURCE.md from the distributed package.
  sourceCommit = process.env.ADAM_MCP_SOURCE_COMMIT;
}
if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
  throw new Error("Build from a Git checkout or set ADAM_MCP_SOURCE_COMMIT to the source archive's full commit ID.");
}
const sourceRepository = manifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
const sourceArchive = `${sourceRepository}/archive/${sourceCommit}.tar.gz`;

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// Code splitting keeps playwright-core behind the dynamic browser-provider import
// so in-process fixture tests do not evaluate it.
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [resolve(root, "packages/mcp/src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  splitting: true,
  outdir: distDir,
  entryNames: "adam-mcp",
  chunkNames: "chunk-[hash]",
  outExtension: { ".js": ".mjs" },
  external: [
    "playwright-core",
    "@modelcontextprotocol/server",
    "@modelcontextprotocol/server/stdio",
    "zod",
    "zod/v4",
    "pdfjs-dist/*",
  ],
});

const entryPath = resolve(distDir, "adam-mcp.mjs");
const entryBody = readFileSync(entryPath, "utf8");
if (!entryBody.startsWith("#!")) {
  writeFileSync(entryPath, `#!/usr/bin/env node\n${entryBody}`);
}

copyFileSync(resolve(root, "LICENSE"), resolve(mcpDir, "LICENSE"));
copyFileSync(resolve(root, "NOTICE"), resolve(mcpDir, "NOTICE"));
writeFileSync(resolve(mcpDir, "SOURCE.md"), [
  `# Corresponding Source for ${manifest.name} ${manifest.version}`,
  "",
  `Source commit: ${sourceCommit}`,
  `Source tree: ${sourceRepository}/tree/${sourceCommit}`,
  `Complete source archive: ${sourceArchive}`,
  "",
  "The archive provides the project's TypeScript source, package-lock.json, build scripts, tests, license and third-party notices. It is available without an ADAM account or npm installation.",
  "",
  "To rebuild, extract the archive and use a supported Node.js LTS release (minimum Node 22). Run npm ci, then npm run build from the source root. A Git checkout supplies its revision automatically. For an archive without .git, set ADAM_MCP_SOURCE_COMMIT to the full source commit above before building. Build requires no ADAM login.",
  "",
  "Project code is GPL-3.0-or-later; retain LICENSE and NOTICE. External npm dependencies retain their own licenses and source distributions. Local builds with modified source are not reviewed release artifacts.",
  "",
].join("\n"));
copyFileSync(resolve(root, "packages/core/src/pdf-extract-worker.mjs"), resolve(distDir, "pdf-extract-worker.mjs"));

console.error("wrote packages/mcp/dist/adam-mcp.mjs (+ lazy browser chunks)");
