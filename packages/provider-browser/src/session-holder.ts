import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { AdamError, throwIfCancelled } from "adam-core";
import { chromium, type BrowserContext } from "playwright-core";
import { assertUrlAllowed } from "./allowlist.ts";
import { localCdpEndpoint, parseDevToolsActivePort } from "./cdp.ts";
import { lifecycleOwnsGeneration, revokeHolderGeneration, withHolderLifecycle, withHolderMutation } from "./holder-lock.ts";
import { defaultOrigin, defaultProfileDir } from "./config.ts";
import { attachDownloadGuard, CHROME_LAUNCH_POLICY, chromeLaunchArgs } from "./download-guard.ts";
import { isLoggedInSnapshot } from "./extract.ts";
import type { PageSnapshot, SessionCookie } from "./session-types.ts";

/**
 * ADR 0009: after one interactive sign-in, a detached headless Chrome holds the
 * session. The MCP server attaches to it over CDP; the login command returns.
 */
export const HOLDER_RECORD_FILE = "session-holder.json";
export const HOLDER_SEED_FILE = "session-seed.json";
export const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";
const HOLDER_RECORD_VERSION = 2;

/** SIGTERM grace before escalating to SIGKILL. */
const STOP_TERM_GRACE_MS = 2_000;
/** Total wait for holder/browser/CDP/DevToolsActivePort to die. */
const STOP_DEADLINE_MS = 15_000;
const STOP_POLL_MS = 100;

export type SessionSeed = {
  cookies: SessionCookie[];
  userAgent?: string;
  /** Written by startSessionHolder; required for a verified handoff record. */
  generation?: string;
};

export type ProcessIdentity = {
  pid: number;
  startTime: string;
  exe: string;
};

export type HolderRecord = {
  version: typeof HOLDER_RECORD_VERSION;
  pid: number;
  generation: string;
  /** Process start token (Linux starttime, ps lstart, or Win CreationDate). */
  pidStartTime: string;
  /** Executable path/command at record write — binds the PID against reuse. */
  exe: string;
  /** Chrome child PID when known; also identity-bound when present. */
  browserPid?: number;
  browserPidStartTime?: string;
  browserExe?: string;
  startedAt: string;
  verifiedAt: string;
  origin: string;
  /** New holders must acknowledge launch settlement before pending cleanup. */
  launchPending?: boolean;
};

function holderStoppedPath(profileDir: string, generation: string): string {
  if (!/^[a-f0-9-]{36}$/.test(generation)) throw new Error("Invalid session generation");
  return join(profileDir, `session-stopped-${generation}.json`);
}

async function pendingLaunchStopped(profileDir: string, record: HolderRecord): Promise<boolean> {
  if (!record.launchPending) return true;
  try { return await readFile(holderStoppedPath(profileDir, record.generation), "utf8") === record.generation; }
  catch { return false; }
}

export function holderRecordPath(profileDir = defaultProfileDir()): string {
  return join(profileDir, HOLDER_RECORD_FILE);
}

export function holderSeedPath(profileDir = defaultProfileDir(), generation?: string): string {
  if (generation !== undefined && !/^[a-f0-9-]{36}$/.test(generation)) throw new Error("Invalid session generation");
  return join(profileDir, generation ? `session-seed-${generation}.json` : HOLDER_SEED_FILE);
}

export function devToolsActivePortPath(profileDir = defaultProfileDir()): string {
  return join(profileDir, DEVTOOLS_ACTIVE_PORT_FILE);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let ownProcessIdentity: ProcessIdentity | undefined;

/**
 * Cross-platform process identity for PID bind.
 * Prefer Linux /proc starttime+exe; on Unix use `ps`; on Windows skip `ps`
 * (Git's ps rejects `-o`) and use WMIC / PowerShell Get-Process.
 * Never invent a bind that would match a reused stranger PID.
 */
export function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!isProcessAlive(pid)) {
    return undefined;
  }
  // This running process cannot have its own PID reused. Foreign PIDs are never cached.
  if (pid === process.pid && ownProcessIdentity) return { ...ownProcessIdentity };
  const identity = readLinuxProcIdentity(pid) ?? (process.platform === "win32"
    ? readWindowsIdentity(pid)
    : readPsIdentity(pid) ?? readWindowsIdentity(pid));
  if (pid === process.pid && identity) ownProcessIdentity = { ...identity };
  return identity;
}

function readLinuxProcIdentity(pid: number): ProcessIdentity | undefined {
  try {
    const exe = readlinkSync(`/proc/${pid}/exe`);
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) {
      return undefined;
    }
    const startTime = stat.slice(closeParen + 2).split(" ")[19];
    if (!startTime) {
      return undefined;
    }
    return { pid, startTime, exe };
  } catch {
    return undefined;
  }
}

/** macOS / BSD / Unix: `ps -o lstart= -o args=`. */
function readPsIdentity(pid: number): ProcessIdentity | undefined {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart=", "-o", "args="], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!out) {
      return undefined;
    }
    // lstart: "Tue Sep 15 16:13:01 2026" then the args/command.
    const match = /^(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(out);
    if (!match) {
      return undefined;
    }
    return { pid, startTime: match[1]!, exe: match[2]! };
  } catch {
    return undefined;
  }
}

/** Windows: WMIC (fast) then PowerShell Get-Process StartTime/Path. */
function readWindowsIdentity(pid: number): ProcessIdentity | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  // Modern Windows often lacks WMIC. Avoid repeated multi-second failed probes.
  return readWindowsPowerShellIdentity(pid) ?? readWindowsWmicIdentity(pid);
}

function readWindowsWmicIdentity(pid: number): ProcessIdentity | undefined {
  try {
    const out = execFileSync(
      "wmic",
      [
        "process",
        "where",
        `ProcessId=${pid}`,
        "get",
        "CreationDate,ExecutablePath",
        "/VALUE",
      ],
      { encoding: "utf8", timeout: 1_000, windowsHide: true },
    );
    let startTime = "";
    let exe = "";
    for (const rawLine of out.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("CreationDate=")) {
        startTime = line.slice("CreationDate=".length).trim();
      } else if (line.startsWith("ExecutablePath=")) {
        exe = line.slice("ExecutablePath=".length).trim();
      }
    }
    // ExecutablePath can be empty for some processes; fall back to a stable token.
    if (!startTime) {
      return undefined;
    }
    if (!exe) {
      exe = `pid:${pid}`;
    }
    return { pid, startTime, exe };
  } catch {
    return undefined;
  }
}

function readWindowsPowerShellIdentity(pid: number): ProcessIdentity | undefined {
  try {
    // Single-line pipe-delimited output avoids multi-line DateTime formatting issues.
    // Get-Process is faster/more reliable than Get-CimInstance on GHA windows-latest.
    const script =
      `$p = Get-Process -Id ${pid} -ErrorAction Stop;` +
      `$exe = if ($p.Path) { $p.Path } else { $p.ProcessName };` +
      `Write-Output ($p.StartTime.ToUniversalTime().ToString("o") + "|" + $exe)`;
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", timeout: 3_000, windowsHide: true },
    ).trim();
    const sep = out.indexOf("|");
    if (sep <= 0 || sep >= out.length - 1) {
      return undefined;
    }
    const startTime = out.slice(0, sep).trim();
    const exe = out.slice(sep + 1).trim();
    if (!startTime || !exe) {
      return undefined;
    }
    return { pid, startTime, exe };
  } catch {
    return undefined;
  }
}

export function matchesProcessIdentity(
  pid: number,
  expected: { startTime: string; exe: string },
): boolean {
  const current = readProcessIdentity(pid);
  if (!current) {
    return false;
  }
  return current.startTime === expected.startTime && current.exe === expected.exe;
}

/** True only when the recorded PID is still the same process (start time + exe). */
export function isBoundHolderAlive(record: HolderRecord): boolean {
  return matchesProcessIdentity(record.pid, {
    startTime: record.pidStartTime,
    exe: record.exe,
  });
}

/**
 * PID to report on session status (ADR 0009). Only the bound live holder.
 * Stale, dead, or identity-mismatched records are absent — never a stranger PID.
 */
export function boundHolderPid(holder: {
  running: boolean;
  record?: HolderRecord;
}): number | undefined {
  if (!holder.running || !holder.record) {
    return undefined;
  }
  if (!isBoundHolderAlive(holder.record)) {
    return undefined;
  }
  return holder.record.pid;
}

export function isBoundBrowserAlive(record: HolderRecord): boolean {
  if (
    typeof record.browserPid !== "number" ||
    typeof record.browserPidStartTime !== "string" ||
    typeof record.browserExe !== "string"
  ) {
    return false;
  }
  return matchesProcessIdentity(record.browserPid, {
    startTime: record.browserPidStartTime,
    exe: record.browserExe,
  });
}

function isValidHolderRecord(parsed: Partial<HolderRecord>): parsed is HolderRecord {
  return (
    parsed?.version === HOLDER_RECORD_VERSION &&
    typeof parsed.pid === "number" &&
    typeof parsed.generation === "string" &&
    parsed.generation.length > 0 &&
    typeof parsed.pidStartTime === "string" &&
    typeof parsed.exe === "string" &&
    typeof parsed.startedAt === "string" &&
    typeof parsed.verifiedAt === "string" &&
    typeof parsed.origin === "string"
  );
}

export async function readHolderRecord(profileDir = defaultProfileDir()): Promise<HolderRecord | undefined> {
  try {
    const parsed = JSON.parse(await readFile(holderRecordPath(profileDir), "utf8")) as Partial<HolderRecord>;
    if (isValidHolderRecord(parsed)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function holderRecordFilePresent(profileDir: string): Promise<boolean> {
  try {
    await access(holderRecordPath(profileDir));
    return true;
  } catch {
    return false;
  }
}

export async function clearHolderFiles(profileDir = defaultProfileDir()): Promise<void> {
  await withHolderLifecycle(profileDir, async () => {
    const record = await readHolderRecord(profileDir);
    if ((record && isBoundHolderAlive(record)) || await chromeOrCdpStillAlive(profileDir, record)) {
      throw new AdamError("provider_unavailable", "The ADAM session is still running. Use logout before clearing session metadata.", false);
    }
    await clearObservedHolderFiles(profileDir);
  });
}

export async function assertHolderLaunchSettled(profileDir: string): Promise<void> {
  if ((await readHolderRecord(profileDir))?.launchPending) {
    throw new AdamError("provider_unavailable", "A prior ADAM browser launch is pending or requires recovery. Do not attach or resume until it has verified or shut down.", false);
  }
}

/** Caller holds the lifecycle claim, or is passive status cleanup. */
async function clearObservedHolderFiles(profileDir: string, expected?: string): Promise<void> {
  const observed = expected ?? await readFile(holderRecordPath(profileDir), "utf8").catch(() => undefined);
  await withHolderMutation(profileDir, async () => {
    const current = await readFile(holderRecordPath(profileDir), "utf8").catch(() => undefined);
    if (observed !== undefined && current === observed) {
      let parsed: Partial<HolderRecord> | undefined;
      try { parsed = JSON.parse(current) as Partial<HolderRecord>; } catch { /* Stale malformed record. */ }
      if (parsed && isValidHolderRecord(parsed) && !(await pendingLaunchStopped(profileDir, parsed))) return;
      await rm(holderRecordPath(profileDir), { force: true });
      if (parsed?.launchPending && parsed.generation) await rm(holderStoppedPath(profileDir, parsed.generation), { force: true });
    }
    // Fixed-path legacy seeds are ambiguous: neither status nor another
    // generation may consume/delete them. New handoffs have unique paths.
  });
}

export async function hasDevToolsActivePort(profileDir = defaultProfileDir()): Promise<boolean> {
  try {
    await access(devToolsActivePortPath(profileDir));
    return true;
  } catch {
    return false;
  }
}

/** Best-effort CDP liveness via the profile DevToolsActivePort (no Playwright attach). */
export async function isCdpAlive(profileDir = defaultProfileDir()): Promise<boolean> {
  try {
    const raw = await readFile(devToolsActivePortPath(profileDir), "utf8");
    const port = parseDevToolsActivePort(raw);
    if (port === undefined) {
      return false;
    }
    const response = await fetch(`${localCdpEndpoint(port)}/json/version`, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function chromeOrCdpStillAlive(
  profileDir: string,
  record: HolderRecord | undefined,
): Promise<boolean> {
  if (record && isBoundBrowserAlive(record)) {
    return true;
  }
  if (await isCdpAlive(profileDir)) {
    return true;
  }
  return false;
}

/** A holder is running only when its record exists and the bound PID still matches. */
export async function holderStatus(
  profileDir = defaultProfileDir(),
): Promise<{ running: boolean; record?: HolderRecord }> {
  const observed = await readFile(holderRecordPath(profileDir), "utf8").catch(() => undefined);
  let record: HolderRecord | undefined;
  try {
    const parsed = JSON.parse(observed ?? "null");
    if (isValidHolderRecord(parsed)) record = parsed;
  } catch { /* Unreadable records are not verified holders. */ }
  if (record && isBoundHolderAlive(record)) {
    return { running: Boolean(record.verifiedAt), record };
  }
  if (record || (await holderRecordFilePresent(profileDir))) {
    // Never clear while Chrome/CDP is still alive — even if the holder PID bind failed.
    if (await chromeOrCdpStillAlive(profileDir, record)) {
      return { running: false, record };
    }
    if (record && !(await pendingLaunchStopped(profileDir, record))) return { running: false, record };
    // Re-check the exact observed record under the publication lock. A record
    // replaced during the CDP probe belongs to another operation.
    if (observed !== undefined) {
      await clearObservedHolderFiles(profileDir, observed);
    }
  }
  return { running: false };
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

/** Prefer process-group kill; fall back to the single PID if the PGID is not ours. */
function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    signalPid(pid, signal);
  }
}

async function sessionFullyStopped(
  profileDir: string,
  record: HolderRecord,
): Promise<boolean> {
  if (isBoundHolderAlive(record) || isBoundBrowserAlive(record)) {
    return false;
  }
  if (await isCdpAlive(profileDir)) {
    return false;
  }
  if (await hasDevToolsActivePort(profileDir)) {
    return false;
  }
  return pendingLaunchStopped(profileDir, record);
}

/**
 * Stop the detached holder. Process-group SIGTERM, then SIGKILL. Refuses to
 * report stopped (and never clears the record) while a bound Chrome/CDP session
 * or DevToolsActivePort is still present. Never signals a PID that fails the
 * start-time/exe bind.
 */
export async function stopSessionHolder(profileDir = defaultProfileDir(), lifecycleGeneration?: string): Promise<boolean> {
  if (lifecycleGeneration !== undefined) {
    if (!(await lifecycleOwnsGeneration(profileDir, lifecycleGeneration))) throw new AdamError("provider_unavailable", "ADAM lifecycle ownership expired.", false);
    return stopSessionHolderOwned(profileDir);
  }
  return withHolderLifecycle(profileDir, () => stopSessionHolderOwned(profileDir));
}

async function stopSessionHolderOwned(profileDir: string): Promise<boolean> {
  const observed = await readFile(holderRecordPath(profileDir), "utf8").catch(() => undefined);
  const record = await readHolderRecord(profileDir);
  const filePresent = record !== undefined || (await holderRecordFilePresent(profileDir));
  if (!filePresent) {
    if (await isCdpAlive(profileDir)) {
      throw new AdamError("provider_unavailable", "A sign-in window is still open without a verified session holder. Close that ADAM window, then retry adam-mcp logout.", false);
    }
    return false;
  }
  if (!record) {
    // Unreadable/stale file: clear only when CDP is already dead.
    if (await isCdpAlive(profileDir)) {
      throw new AdamError(
        "provider_unavailable",
        "A Chrome debug port is still live but the session-holder record is unreadable. Close the ADAM Chrome process, then retry adam-mcp logout.",
      );
    }
    await rm(devToolsActivePortPath(profileDir), { force: true }).catch(() => undefined);
    await clearObservedHolderFiles(profileDir, observed);
    return false;
  }

  const holderBound = isBoundHolderAlive(record);
  const browserBound = isBoundBrowserAlive(record);

  if (!holderBound && !browserBound) {
    // Stale PID reuse or dead record: never signal the stranger PID.
    if (await chromeOrCdpStillAlive(profileDir, record)) {
      throw new AdamError(
        "provider_unavailable",
        "Session-holder PID bind failed but Chrome/CDP is still alive. Close the ADAM Chrome process, then retry adam-mcp logout.",
      );
    }
    if (!(await pendingLaunchStopped(profileDir, record))) {
      throw new AdamError("provider_unavailable", "The prior ADAM browser launch has no shutdown acknowledgement. Stop all dedicated ADAM Chrome and MCP processes before recovering the profile; a new session cannot safely start yet.", false);
    }
    await rm(devToolsActivePortPath(profileDir), { force: true }).catch(() => undefined);
    await clearObservedHolderFiles(profileDir, observed);
    return false;
  }

  if (holderBound) {
    signalProcessGroup(record.pid, "SIGTERM");
  }
  if (browserBound && typeof record.browserPid === "number") {
    signalProcessGroup(record.browserPid, "SIGTERM");
  }

  const termDeadline = Date.now() + STOP_TERM_GRACE_MS;
  while (Date.now() < termDeadline) {
    if (!isBoundHolderAlive(record) && !isBoundBrowserAlive(record)) {
      break;
    }
    await delay(STOP_POLL_MS);
  }

  if (isBoundHolderAlive(record)) {
    signalProcessGroup(record.pid, "SIGKILL");
  }
  if (isBoundBrowserAlive(record) && typeof record.browserPid === "number") {
    signalProcessGroup(record.browserPid, "SIGKILL");
  }

  const deadline = Date.now() + STOP_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (!isBoundHolderAlive(record) && !isBoundBrowserAlive(record) && !(await isCdpAlive(profileDir))) {
      // Chrome may leave DevToolsActivePort after SIGKILL; unlink only once CDP is dead.
      if (await hasDevToolsActivePort(profileDir)) {
        await rm(devToolsActivePortPath(profileDir), { force: true }).catch(() => undefined);
      }
      if (await sessionFullyStopped(profileDir, record)) {
        await clearObservedHolderFiles(profileDir, observed);
        return true;
      }
    }
    await delay(STOP_POLL_MS);
  }

  // Never clear the holder record while Chrome/CDP is still alive.
  throw new AdamError(
    "provider_unavailable",
    "Could not fully stop the headless ADAM session (Chrome/CDP still alive). Retry adam-mcp logout.",
  );
}

export type StartHolderOptions = {
  profileDir?: string;
  origin?: string;
  seed: SessionSeed;
  /** Test seam: returns the detached holder process. */
  spawnHolder?: (seedFile: string) => ChildProcess | undefined;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Internal capability for an interactive/resume operation already holding ownership. */
  lifecycleGeneration?: string;
};

export async function startSessionHolder(options: StartHolderOptions): Promise<HolderRecord> {
  throwIfCancelled(options.signal);
  const profileDir = options.profileDir ?? defaultProfileDir();
  const origin = options.origin ?? defaultOrigin();
  assertUrlAllowed(origin);
  await mkdir(profileDir, { recursive: true });
  if (options.lifecycleGeneration !== undefined) {
    if (!(await lifecycleOwnsGeneration(profileDir, options.lifecycleGeneration))) throw new AdamError("provider_unavailable", "ADAM lifecycle ownership expired.", false);
    return startSessionHolderOwned(options, profileDir, options.lifecycleGeneration);
  }
  return withHolderLifecycle(profileDir, (generation) => startSessionHolderOwned(options, profileDir, generation), options.signal);
}

async function startSessionHolderOwned(options: StartHolderOptions, profileDir: string, generation: string): Promise<HolderRecord> {
  // An old fixed-path handoff can belong to a pre-lock client. Do not overwrite
  // or delete it, and do not start competing Chrome against the same profile.
  if (await access(holderSeedPath(profileDir)).then(() => true, () => false)) {
    throw new AdamError("provider_unavailable", "An older ADAM session handoff is pending. Stop all older ADAM MCP processes and recover the dedicated profile before retrying login.", false);
  }

  // Re-login: stop + await the prior holder before writing a new seed.
  await stopSessionHolderOwned(profileDir);

  const seedFile = holderSeedPath(profileDir, generation);
  let seedCreated = false;
  let childIdentity: ProcessIdentity | undefined;
  try {
    throwIfCancelled(options.signal);
    // Exclusive creation establishes cleanup ownership even if writing fails.
    const handoff = await open(seedFile, "wx", 0o600);
    seedCreated = true;
    try { await handoff.writeFile(JSON.stringify({ ...options.seed, generation } satisfies SessionSeed), "utf8"); }
    finally { await handoff.close(); }
    const spawnHolder = options.spawnHolder ?? defaultHolderSpawn;
    const child = spawnHolder(seedFile);
    let spawnError: Error | undefined;
    child?.once("error", (error) => { spawnError = error; });
    child?.unref();
    childIdentity = child?.pid ? readProcessIdentity(child.pid) : undefined;
    const deadline = Date.now() + (options.timeoutMs ?? 45_000);
    while (Date.now() < deadline) {
      throwIfCancelled(options.signal);
      if (spawnError) throw new AdamError("provider_unavailable", "Could not start the background ADAM session. Run adam-mcp login to retry.", false);
      await delay(300);
      const status = await holderStatus(profileDir);
      // Only accept a NEW verified record for this generation — never the prior holder.
      if (
        status.running &&
        status.record?.generation === generation &&
        status.record.verifiedAt &&
        status.record.startedAt
      ) {
        throwIfCancelled(options.signal);
        return status.record;
      }
    }
    throw new AdamError(
      "provider_unavailable",
      "The headless ADAM session did not start in time. Retry adam-mcp login.",
    );
  } catch (error) {
    // Atomically revoke publication before observing ownership for cleanup.
    // A child that has not yet published cannot race this failure path later.
    await revokeHolderGeneration(profileDir, generation);
    const record = await readHolderRecord(profileDir);
    if (record?.generation === generation) {
      await stopSessionHolderOwned(profileDir);
    } else {
      if (childIdentity && matchesProcessIdentity(childIdentity.pid, { startTime: childIdentity.startTime, exe: childIdentity.exe })) {
        signalProcessGroup(childIdentity.pid, "SIGKILL");
      }
      // Never erase ownership evidence while an unverified Chrome endpoint is live.
      // Do not remove any shared record or legacy seed from this failure path.
    }
    throw error;
  } finally {
    if (seedCreated) await withHolderMutation(profileDir, () => rm(seedFile, { force: true }));
  }
}

function defaultHolderSpawn(seedFile: string): ChildProcess {
  const entry = process.argv[1] ?? "";
  const args = isTypeScriptEntry(entry)
    ? [resolveTypeScriptLoader(), mcpDevEntry(), "session-holder", seedFile]
    : [entry, "session-holder", seedFile];
  return spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
}

function isTypeScriptEntry(entry: string): boolean {
  return entry.endsWith(".ts") || entry.endsWith(".mts");
}

/** Dev mode: the holder entry is the MCP CLI, not whichever CLI started the login. */
function mcpDevEntry(): string {
  return fileURLToPath(new URL("../../mcp/src/index.ts", import.meta.url));
}

/** Dev mode only: run the holder through the repo's tsx loader. */
function resolveTypeScriptLoader(): string {
  return fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
}

function browserIdentityFromContext(context: BrowserContext): ProcessIdentity | undefined {
  // Playwright's Browser.process() exists for locally launched browsers; typings omit it on Browser.
  const browser = context.browser() as { process?: () => { pid?: number } | null } | null;
  const pid = browser?.process?.()?.pid;
  if (typeof pid !== "number") {
    return undefined;
  }
  return readProcessIdentity(pid);
}

/**
 * Hidden CLI command: own a headless Chrome with the authenticated cookie jar,
 * write the holder record, and stay alive until signaled.
 */
export async function runSessionHolder(seedFile: string, options: {
  /** Test seam: logical handoff tests do not depend on native OS probe latency. */
  readOwnIdentity?: () => ProcessIdentity | undefined;
} = {}): Promise<void> {
  const profileDir = dirname(seedFile);
  const origin = defaultOrigin();
  let seed: SessionSeed;
  await withHolderMutation(profileDir, async () => {
    seed = JSON.parse(await readFile(seedFile, "utf8")) as SessionSeed;
    if (!seed.generation || seedFile !== holderSeedPath(profileDir, seed.generation) || !(await lifecycleOwnsGeneration(profileDir, seed.generation))) {
      throw new AdamError("provider_unavailable", "The ADAM session handoff no longer owns startup.", false);
    }
    await rm(seedFile, { force: true });
  });

  const generation = seed!.generation!;
  const identity = options.readOwnIdentity ? options.readOwnIdentity() : readProcessIdentity(process.pid);
  if (!identity) throw new AdamError("provider_unavailable", "Could not bind ADAM session process identity.", false);
  const record: HolderRecord = {
    version: HOLDER_RECORD_VERSION, pid: process.pid, generation,
    pidStartTime: identity.startTime, exe: identity.exe,
    startedAt: new Date().toISOString(), verifiedAt: "", origin, launchPending: true,
  };
  // Publish bound-but-unverified ownership BEFORE launching Chrome. If the
  // starter times out afterwards, it can stop this exact process before a new
  // startup is admitted. A late child cannot publish after capability revocation.
  await withHolderMutation(profileDir, async () => {
    if (!(await lifecycleOwnsGeneration(profileDir, generation))) {
      throw new AdamError("provider_unavailable", "The ADAM session startup was abandoned.", false);
    }
    await writeFile(holderRecordPath(profileDir), JSON.stringify(record), { encoding: "utf8", flag: "wx", mode: 0o600 });
  });
  let launch: Promise<BrowserContext> | undefined;
  let shuttingDown: Promise<void> | undefined;
  const shutdown = (code = 0): Promise<void> => {
    shuttingDown ??= (async () => {
      // A signal during launch must wait for launch to settle and Chrome to
      // close. If force-killed first, no acknowledgement is written: fail closed.
      // A rejected launch may still have spawned Chrome. It must never produce
      // a shutdown acknowledgement without a context whose close completed.
      const opened = await launch;
      if (!opened) { process.exit(1); return; }
      await opened.close();
      await withHolderMutation(profileDir, async () => {
        const current = await readHolderRecord(profileDir);
        if (current?.generation === generation && current.launchPending) {
          await writeFile(holderStoppedPath(profileDir, generation), generation, { mode: 0o600 });
        }
      });
      process.exit(code);
    })();
    return shuttingDown;
  };
  process.on("SIGTERM", () => { void shutdown(0).catch(() => process.exit(1)); });
  process.on("SIGINT", () => { void shutdown(0).catch(() => process.exit(1)); });
  launch = chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: true,
    acceptDownloads: CHROME_LAUNCH_POLICY.acceptDownloads,
    viewport: { width: 1280, height: 900 },
    locale: "de-CH",
    ...(seed!.userAgent ? { userAgent: seed!.userAgent } : {}),
    args: chromeLaunchArgs(),
  });
  const context = await launch;
  if (shuttingDown) { await shuttingDown; return; }
  const page = context.pages()[0] ?? (await context.newPage());
  attachDownloadGuard(page);
  context.on("page", (opened) => {
    attachDownloadGuard(opened);
  });

  context.on("close", () => {
    // Leave the ownership record for serialized stop/status cleanup. A dying
    // holder must never clear a newer generation's metadata.
    void shutdown(0).catch(() => process.exit(1));
  });

  try {
    await context.addCookies(seed!.cookies);
    assertUrlAllowed(origin);
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page
      .waitForFunction(
        `(() => {
          const text = (document.body ? document.body.innerText : "").toLowerCase();
          return /abmelden|log out|logout|persönlicher schreibtisch|dashboard/.test(text);
        })()`,
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => undefined);
    const text = await page.locator("body").innerText().catch(() => "");
    const snapshot: PageSnapshot = { url: page.url(), title: await page.title(), html: "", text, links: [] };
    if (!isLoggedInSnapshot(snapshot)) {
      await shutdown(1);
    }
    const browserIdentity = browserIdentityFromContext(context);
    const now = new Date().toISOString();
    const verified: HolderRecord = {
      ...record,
      launchPending: false,
      ...(browserIdentity
        ? {
            browserPid: browserIdentity.pid,
            browserPidStartTime: browserIdentity.startTime,
            browserExe: browserIdentity.exe,
          }
        : {}),
      verifiedAt: now,
    };
    await withHolderMutation(profileDir, async () => {
      if (!(await lifecycleOwnsGeneration(profileDir, generation)) || (await readHolderRecord(profileDir))?.generation !== generation) {
        throw new AdamError("provider_unavailable", "The ADAM session startup was abandoned.", false);
      }
      const temporary = join(profileDir, `session-record-${generation}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(verified), { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(temporary, holderRecordPath(profileDir));
      } finally { await rm(temporary, { force: true }); }
    });
  } catch (error) {
    await shutdown(1);
    throw error;
  }

  // Keep the process (and Chrome) alive until logout/SIGTERM.
  setInterval(() => undefined, 60_000);
}
