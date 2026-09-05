import * as esbuild from "esbuild";
import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = resolve(root, "packages/mcp");

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [resolve(root, "packages/mcp/src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: resolve(mcpDir, "dist/adam-mcp.mjs"),
  banner: { js: "#!/usr/bin/env node" },
  external: [
    "playwright-core",
    "@modelcontextprotocol/server",
    "@modelcontextprotocol/server/stdio",
    "zod",
    "zod/v4",
  ],
});

copyFileSync(resolve(root, "LICENSE"), resolve(mcpDir, "LICENSE"));
copyFileSync(resolve(root, "NOTICE"), resolve(mcpDir, "NOTICE"));

console.error("wrote packages/mcp/dist/adam-mcp.mjs");
