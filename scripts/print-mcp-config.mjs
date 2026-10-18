// Compatibility entry: host templates live in the packaged CLI.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../packages/mcp/dist/adam-mcp.mjs", import.meta.url)), "setup", ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });
process.exitCode = result.status ?? 1;
