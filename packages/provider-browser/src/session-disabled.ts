import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Explicit logout persists across MCP restarts; only explicit login enables resume. */
export async function sessionDisabled(profileDir: string): Promise<boolean> {
  try { await access(join(profileDir, "session-disabled")); return true; } catch { return false; }
}

export async function disableSession(profileDir: string): Promise<void> {
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "session-disabled"), "Explicit logout: run adam-mcp login to reconnect.\n", { mode: 0o600 });
}

export async function enableSession(profileDir: string): Promise<void> {
  await rm(join(profileDir, "session-disabled"), { force: true });
}
