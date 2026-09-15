import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { AdamError } from "adam-core";
import { chromium, type BrowserContext } from "playwright-core";
import { assertUrlAllowed } from "./allowlist.ts";
import { localCdpEndpoint, parseDevToolsActivePort } from "./cdp.ts";
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
};

export function holderRecordPath(profileDir = defaultProfileDir()): string {
  return join(profileDir, HOLDER_RECORD_FILE);
}

export function holderSeedPath(profileDir = defaultProfileDir()): string {
  return join(profileDir, HOLDER_SEED_FILE);
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

/** Linux /proc identity for a live PID; undefined if the PID is gone or unreadable. */
/**
 * Cross-platform process identity for PID bind.
 * Prefer Linux /proc starttime+exe; fall back to `ps` (macOS/Unix) or
 * Win32 CIM CreationDate+ExecutablePath. Never invent a bind that would
 * match a reused stranger PID — if identity cannot be read, return undefined.
 */
export function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!isProcessAlive(pid)) {
    return undefined;
  }
  return readLinuxProcIdentity(pid) ?? readPsIdentity(pid) ?? readWindowsIdentity(pid);
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

/** Windows: Win32_Process CreationDate + ExecutablePath via PowerShell CIM. */
function readWindowsIdentity(pid: number): ProcessIdentity | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  try {
    const script =
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";` +
      ` if ($null -eq $p) { exit 1 };` +
      ` Write-Output $p.CreationDate;` +
      ` Write-Output $p.ExecutablePath;`;
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: 5_000, windowsHide: true },
    ).trim();
    const lines = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length < 2 || !lines[0] || !lines[1]) {
      return undefined;
    }
    return { pid, startTime: lines[0], exe: lines[1] };
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
  await rm(holderRecordPath(profileDir), { force: true }).catch(() => undefined);
  await rm(holderSeedPath(profileDir), { force: true }).catch(() => undefined);
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
  const record = await readHolderRecord(profileDir);
  if (record && isBoundHolderAlive(record)) {
    return { running: true, record };
  }
  if (record || (await holderRecordFilePresent(profileDir))) {
    // Never clear while Chrome/CDP is still alive — even if the holder PID bind failed.
    if (await chromeOrCdpStillAlive(profileDir, record)) {
      return { running: false, record };
    }
    await clearHolderFiles(profileDir);
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
  return true;
}

/**
 * Stop the detached holder. Process-group SIGTERM, then SIGKILL. Refuses to
 * report stopped (and never clears the record) while a bound Chrome/CDP session
 * or DevToolsActivePort is still present. Never signals a PID that fails the
 * start-time/exe bind.
 */
export async function stopSessionHolder(profileDir = defaultProfileDir()): Promise<boolean> {
  const record = await readHolderRecord(profileDir);
  const filePresent = record !== undefined || (await holderRecordFilePresent(profileDir));
  if (!filePresent) {
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
    await clearHolderFiles(profileDir);
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
    await rm(devToolsActivePortPath(profileDir), { force: true }).catch(() => undefined);
    await clearHolderFiles(profileDir);
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
        await clearHolderFiles(profileDir);
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
};

export async function startSessionHolder(options: StartHolderOptions): Promise<HolderRecord> {
  const profileDir = options.profileDir ?? defaultProfileDir();
  const origin = options.origin ?? defaultOrigin();
  await mkdir(profileDir, { recursive: true });

  // Re-login: stop + await the prior holder before writing a new seed.
  await stopSessionHolder(profileDir);

  const generation = randomUUID();
  const seedFile = holderSeedPath(profileDir);
  // Transient handoff: the holder reads and unlinks this before launching Chrome.
  await writeFile(
    seedFile,
    JSON.stringify({ ...options.seed, generation } satisfies SessionSeed),
    { encoding: "utf8", mode: 0o600 },
  );
  const spawnHolder = options.spawnHolder ?? defaultHolderSpawn;
  spawnHolder(seedFile)?.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 45_000);
  while (Date.now() < deadline) {
    await delay(300);
    const status = await holderStatus(profileDir);
    // Only accept a NEW verified record for this generation — never the prior holder.
    if (
      status.running &&
      status.record?.generation === generation &&
      status.record.verifiedAt &&
      status.record.startedAt
    ) {
      return status.record;
    }
  }
  await clearHolderFiles(profileDir);
  throw new AdamError(
    "provider_unavailable",
    "The headless ADAM session did not start in time. Retry adam-mcp login.",
  );
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
export async function runSessionHolder(seedFile: string): Promise<void> {
  const profileDir = dirname(seedFile);
  const origin = defaultOrigin();
  let seed: SessionSeed;
  try {
    seed = JSON.parse(await readFile(seedFile, "utf8")) as SessionSeed;
  } finally {
    await rm(seedFile, { force: true }).catch(() => undefined);
  }

  const generation = seed.generation ?? randomUUID();
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: true,
    acceptDownloads: CHROME_LAUNCH_POLICY.acceptDownloads,
    viewport: { width: 1280, height: 900 },
    locale: "de-CH",
    ...(seed.userAgent ? { userAgent: seed.userAgent } : {}),
    args: chromeLaunchArgs(),
  });
  const page = context.pages()[0] ?? (await context.newPage());
  attachDownloadGuard(page);
  context.on("page", (opened) => {
    attachDownloadGuard(opened);
  });

  const shutdown = async (code = 0): Promise<void> => {
    await clearHolderFiles(profileDir);
    await context.close().catch(() => undefined);
    process.exit(code);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  context.on("close", () => {
    void clearHolderFiles(profileDir).then(() => process.exit(0));
  });

  try {
    await context.addCookies(seed.cookies);
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
    const identity = readProcessIdentity(process.pid);
    if (!identity) {
      await shutdown(1);
      return;
    }
    const browserIdentity = browserIdentityFromContext(context);
    const now = new Date().toISOString();
    const record: HolderRecord = {
      version: HOLDER_RECORD_VERSION,
      pid: process.pid,
      generation,
      pidStartTime: identity.startTime,
      exe: identity.exe,
      ...(browserIdentity
        ? {
            browserPid: browserIdentity.pid,
            browserPidStartTime: browserIdentity.startTime,
            browserExe: browserIdentity.exe,
          }
        : {}),
      startedAt: now,
      verifiedAt: now,
      origin,
    };
    await writeFile(holderRecordPath(profileDir), JSON.stringify(record), "utf8");
  } catch (error) {
    await clearHolderFiles(profileDir);
    await context.close().catch(() => undefined);
    throw error;
  }

  // Keep the process (and Chrome) alive until logout/SIGTERM.
  setInterval(() => undefined, 60_000);
}
