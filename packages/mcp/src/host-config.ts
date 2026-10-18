import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "smol-toml";
import { AdamError } from "adam-core";

export const HOST_CLIENTS = ["codex", "cursor", "claude-desktop", "windsurf", "vscode"] as const;
export type HostClient = typeof HOST_CLIENTS[number];
export const TOOL_TIMEOUT_SECONDS = 2100;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdamError("provider_unavailable", "Configuration must contain an object. Nothing was changed.", false);
  }
  return value as Record<string, unknown>;
}

export function hostEntry(client: HostClient, entryPath: string, nodePath = process.execPath): Record<string, unknown> {
  return {
    ...(client === "vscode" ? { type: "stdio" } : {}),
    command: resolve(nodePath), args: [resolve(entryPath)],
    ...(client === "codex" ? { startup_timeout_sec: 30, tool_timeout_sec: TOOL_TIMEOUT_SECONDS } : {}),
  };
}

export function renderHostConfig(client: HostClient, entryPath: string, nodePath = process.execPath): string {
  const entry = hostEntry(client, entryPath, nodePath);
  return client === "codex"
    ? stringify({ mcp_servers: { adam: entry } }) + "\n"
    : JSON.stringify({ [client === "vscode" ? "servers" : "mcpServers"]: { adam: entry } }, null, 2) + "\n";
}

export function defaultHostPath(client: HostClient): string {
  const home = homedir();
  switch (client) {
    case "codex": return join(process.env.CODEX_HOME || join(home, ".codex"), "config.toml");
    case "cursor": return join(home, ".cursor", "mcp.json");
    case "windsurf": return join(home, ".codeium", "windsurf", "mcp_config.json");
    case "vscode": return resolve(".vscode", "mcp.json");
    case "claude-desktop":
      if (platform() === "win32") return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
      if (platform() === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      throw new AdamError("provider_unavailable", "Supply --output for this Claude Desktop installation.", false);
  }
}

export function mergeHostConfig(client: HostClient, previous: string, entryPath: string, nodePath = process.execPath): string {
  let data: Record<string, unknown>;
  try {
    data = previous.trim() ? object(client === "codex" ? parse(previous, { integersAsBigInt: true }) : JSON.parse(previous)) : {};
  } catch {
    // Parser errors can contain existing secrets. Do not echo them.
    throw new AdamError("provider_unavailable", "Existing configuration could not be parsed. Nothing was changed. Use preview or a separate --output file.", false);
  }
  const key = client === "codex" ? "mcp_servers" : client === "vscode" ? "servers" : "mcpServers";
  const servers = data[key] === undefined ? {} : object(data[key]);
  // Preserve user tool permissions and unrelated per-server options.
  const prior = servers.adam === undefined ? {} : object(servers.adam);
  const next = { ...prior, ...hostEntry(client, entryPath, nodePath) };
  // A local command must never keep an old remote transport/authentication.
  for (const field of ["url", "auth", "bearer_token_env_var", "http_headers", "env_http_headers", "http_headers_helper", "oauth"]) delete next[field];
  if (client !== "vscode") delete next.type;
  if (client === "codex") {
    next.startup_timeout_sec = BigInt(30);
    next.tool_timeout_sec = BigInt(TOOL_TIMEOUT_SECONDS);
  }
  data[key] = { ...servers, adam: next };
  return client === "codex" ? stringify(data, { numbersAsFloat: true }) + "\n" : JSON.stringify(data, null, 2) + "\n";
}

/** Backup plus same-directory rename; never overwrite an unreadable or symlinked config. */
export async function installHostConfig(client: HostClient, path: string, entryPath: string, nodePath = process.execPath): Promise<{ path: string; backup?: string }> {
  const target = resolve(path);
  let previous: string | undefined;
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new AdamError("provider_unavailable", "Configuration target must be a regular file, not a link or directory.", false);
    previous = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const content = mergeHostConfig(client, previous ?? "", entryPath, nodePath);
  await mkdir(dirname(target), { recursive: true });
  const backup = previous === undefined ? undefined : `${target}.adam-backup-${randomUUID()}`;
  const temporary = `${target}.adam-${randomUUID()}.tmp`;
  try {
    if (backup) await copyFile(target, backup, constants.COPYFILE_EXCL);
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    // Refuse a concurrent edit instead of replacing newer user configuration.
    let current: string | undefined;
    try { current = await readFile(target, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current !== previous) throw new AdamError("provider_unavailable", "Configuration changed during setup. Retry; the newer file was preserved.", false);
    await rename(temporary, target);
    return { path: target, ...(backup ? { backup } : {}) };
  } finally { await rm(temporary, { force: true }); }
}
