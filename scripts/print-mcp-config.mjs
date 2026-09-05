import { existsSync } from "node:fs";
import { platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(root, "packages/mcp/dist/adam-mcp.mjs");

if (!existsSync(bin)) {
  console.error("Missing compiled CLI. Run npm run build first (npm run setup does that).");
  process.exit(1);
}

const windows = platform() === "win32";

function snippet(browser) {
  const args = windows
    ? ["/c", "node", bin, ...(browser ? ["--browser"] : [])]
    : [bin, ...(browser ? ["--browser"] : [])];
  const cursor = windows
    ? { command: "cmd", args }
    : { command: "node", args: browser ? [bin, "--browser"] : [bin] };
  const vscode = {
    type: "stdio",
    command: windows ? "cmd" : "node",
    args: windows ? ["/c", "node", bin, ...(browser ? ["--browser"] : [])] : browser ? [bin, "--browser"] : [bin],
  };
  const claude = windows
    ? `claude mcp add adam -- cmd /c node ${bin}${browser ? " --browser" : ""}`
    : `claude mcp add adam -- node ${bin}${browser ? " --browser" : ""}`;
  return { cursor, vscode, claude };
}

const fixture = snippet(false);
const live = snippet(true);

console.error(`adam-mcp setup
Repo: ${root}
CLI:  ${bin}

Fixture snippet: synthetic catalog, no Chrome login.
Live snippet: add --browser, then run: npm run login
`);

console.log("Fixture — Cursor / Claude Desktop / Windsurf:");
console.log(JSON.stringify({ mcpServers: { adam: fixture.cursor } }, null, 2));
console.log("");
console.log("Live ADAM — Cursor / Claude Desktop / Windsurf:");
console.log(JSON.stringify({ mcpServers: { adam: live.cursor } }, null, 2));
console.log("");
console.log("Fixture — VS Code Copilot (.vscode/mcp.json):");
console.log(JSON.stringify({ servers: { adam: fixture.vscode } }, null, 2));
console.log("");
console.log("Live ADAM — VS Code Copilot (.vscode/mcp.json):");
console.log(JSON.stringify({ servers: { adam: live.vscode } }, null, 2));
console.log("");
console.log("Claude Code (fixture):");
console.log(fixture.claude);
console.log("Claude Code (live ADAM):");
console.log(live.claude);
