import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = resolve(root, "packages/mcp");
const distDir = resolve(mcpDir, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// Code splitting keeps playwright-core behind the dynamic browser-provider import
// so fixture/default MCP startup does not evaluate it.
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
  ],
});

const entryPath = resolve(distDir, "adam-mcp.mjs");
const entryBody = readFileSync(entryPath, "utf8");
if (!entryBody.startsWith("#!")) {
  writeFileSync(entryPath, `#!/usr/bin/env node\n${entryBody}`);
}

copyFileSync(resolve(root, "LICENSE"), resolve(mcpDir, "LICENSE"));
copyFileSync(resolve(root, "NOTICE"), resolve(mcpDir, "NOTICE"));

console.error("wrote packages/mcp/dist/adam-mcp.mjs (+ lazy browser chunks)");
