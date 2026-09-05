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
const cursor = windows
  ? {
      command: "cmd",
      args: ["/c", "node", bin, "--browser"],
    }
  : {
      command: "node",
      args: [bin, "--browser"],
    };

const vscode = {
  type: "stdio",
  command: windows ? "cmd" : "node",
  args: windows ? ["/c", "node", bin, "--browser"] : [bin, "--browser"],
};

console.error(`adam-mcp setup
Repo: ${root}
CLI:  ${bin}

1. Keep Google Chrome closed for this profile except the login window.
2. Run: npm run login   (SWITCH edu-ID in Chrome; leave that window open)
3. Paste one of the snippets below into your host. Absolute paths; no cwd required.
ChatGPT cannot run this stdio server. Never paste the SWITCH password into chat.
`);

console.log("Cursor / Claude Desktop / Windsurf (mcpServers):");
console.log(
  JSON.stringify(
    {
      mcpServers: {
        adam: cursor,
      },
    },
    null,
    2,
  ),
);
console.log("");
console.log("VS Code Copilot (.vscode/mcp.json servers):");
console.log(
  JSON.stringify(
    {
      servers: {
        adam: vscode,
      },
    },
    null,
    2,
  ),
);
console.log("");
console.log("Claude Code:");
if (windows) {
  console.log(`claude mcp add adam -- cmd /c node ${bin} --browser`);
} else {
  console.log(`claude mcp add adam -- node ${bin} --browser`);
}
