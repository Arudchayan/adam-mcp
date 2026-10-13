import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { parse } from "smol-toml";
import { readFile } from "node:fs/promises";
import { defaultHostPath, TOOL_TIMEOUT_SECONDS, type HostClient } from "./host-config.ts";

export type DiagnosticCheck = { name: string; state: "pass" | "warning" | "error"; message: string };

async function exists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

/** Check installed Chrome paths without starting any browser or invoking a shell. */
export async function chromeAvailable(): Promise<boolean> {
  const candidates = process.platform === "win32"
    ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter((p): p is string => !!p).map((p) => join(p, "Google", "Chrome", "Application", "chrome.exe"))
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
      : ["/opt/google/chrome/chrome", ...(process.env.PATH ?? "").split(":").filter(Boolean).map((p) => join(p, "google-chrome")), ...(process.env.PATH ?? "").split(":").filter(Boolean).map((p) => join(p, "google-chrome-stable"))];
  return (await Promise.all(candidates.map(exists))).some(Boolean);
}

async function writableAncestor(path: string): Promise<boolean> {
  let current = resolve(path);
  while (true) {
    try { await stat(current); await access(current, constants.W_OK); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      const parent = dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }
}

export async function diagnose(entryPath: string, options: {
  client?: HostClient; configPath?: string;
  // Test seams ensure diagnostics are passive.
  chrome?: () => Promise<boolean>;
  session?: () => Promise<{ loggedIn: boolean; connectionState?: string; recoveryAction?: string }>;
  profileDir?: string;
} = {}): Promise<{ ready: boolean; checks: DiagnosticCheck[] }> {
  const checks: DiagnosticCheck[] = [];
  const nodeOk = Number(process.versions.node.split(".")[0]) >= 20;
  checks.push({ name: "node", state: nodeOk ? "pass" : "error", message: nodeOk ? "Node.js is supported." : "Install Node.js 20 or later." });
  const entryOk = await exists(entryPath);
  checks.push({ name: "server", state: entryOk ? "pass" : "error", message: entryOk ? "Server entry is available." : "Build or reinstall ADAM MCP." });
  const chromeOk = await (options.chrome ?? chromeAvailable)();
  checks.push({ name: "chrome", state: chromeOk ? "pass" : "error", message: chromeOk ? "Google Chrome was found." : "Google Chrome was not found in standard install locations. Install Chrome or check your installation." });
  const profileDir = options.profileDir ?? (process.env.ADAM_BROWSER_PROFILE_DIR?.trim() || join(homedir(), ".adam-mcp", "chrome-profile"));
  const profileOk = await writableAncestor(profileDir);
  checks.push({ name: "profile", state: profileOk ? "pass" : "error", message: profileOk ? "The session profile location is writable." : "The session profile location is not writable." });
  if (options.client) {
    try {
      const source = await readFile(options.configPath ?? defaultHostPath(options.client), "utf8");
      const parsed = options.client === "codex" ? parse(source) : JSON.parse(source);
      const entry = parsed?.[options.client === "codex" ? "mcp_servers" : options.client === "vscode" ? "servers" : "mcpServers"]?.adam;
      const matches = entry?.command === process.execPath && Array.isArray(entry.args) && entry.args.length === 1 && resolve(entry.args[0]) === resolve(entryPath);
      const timeoutOk = options.client !== "codex" || entry?.tool_timeout_sec >= TOOL_TIMEOUT_SECONDS;
      checks.push({ name: "client", state: matches && timeoutOk ? "pass" : "warning", message: matches && timeoutOk ? "Client points to this server with the expected settings." : "Run setup for this client to update the server entry or timeout." });
    } catch {
      checks.push({ name: "client", state: "warning", message: "Client configuration is missing, unreadable or invalid. Run setup; invalid existing files are preserved." });
    }
  }
  try {
    let session = options.session;
    if (!session) {
      const { createPlaywrightSession } = await import("adam-provider-browser");
      session = async () => { const handle = createPlaywrightSession(); try { return await handle.status(); } finally { await handle.close(); } };
    }
    const status = await session();
    checks.push({ name: "session", state: status.loggedIn ? "pass" : "warning", message: status.loggedIn ? "ADAM is connected." : status.connectionState === "signed-out" ? "Locally signed out. Run login when ready." : status.connectionState === "signing-in" ? "Finish or close the existing sign-in window." : "ADAM is not currently connected. Run login to verify saved sign-in or sign in again." });
  } catch {
    checks.push({ name: "session", state: "warning", message: "Session status could not be verified. Run status, then login if needed." });
  }
  return { ready: checks.every((check) => check.state !== "error"), checks };
}
