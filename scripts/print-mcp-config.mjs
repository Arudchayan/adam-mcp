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

function snippet() {
  const args = windows ? ["/c", "node", bin] : [bin];
  const cursor = windows ? { command: "cmd", args } : { command: "node", args: [bin] };
  const vscode = {
    type: "stdio",
    command: windows ? "cmd" : "node",
    args: windows ? ["/c", "node", bin] : [bin],
  };
  const claude = windows
    ? `claude mcp add adam -- cmd /c node ${bin}`
    : `claude mcp add adam -- node ${bin}`;
  return { cursor, vscode, claude };
}

function tomlBasic(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function codexToml(entry) {
  const rendered = entry.args.map((arg) => tomlBasic(arg)).join(", ");
  return `[mcp_servers.adam]\ncommand = ${tomlBasic(entry.command)}\nargs = [${rendered}]`;
}

const live = snippet();

console.error(`adam-mcp setup
Repo: ${root}
CLI:  ${bin}

Live ADAM: paste a snippet below, then run: npm run login
(--browser is optional; it is the default.)
`);

console.log("Cursor / Claude Desktop / Windsurf:");
console.log(JSON.stringify({ mcpServers: { adam: live.cursor } }, null, 2));
console.log("");
console.log("VS Code Copilot (.vscode/mcp.json):");
console.log(JSON.stringify({ servers: { adam: live.vscode } }, null, 2));
console.log("");
console.log("Claude Code:");
console.log(live.claude);
console.log("");
console.log("ChatGPT desktop / Codex (~/.codex/config.toml):");
console.log(codexToml(live.cursor));
