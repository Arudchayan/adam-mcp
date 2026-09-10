import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { AdamError } from "adam-core";
import { chromium } from "playwright-core";
import { assertUrlAllowed } from "./allowlist.ts";
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
const HOLDER_RECORD_VERSION = 1;

export type SessionSeed = {
  cookies: SessionCookie[];
  userAgent?: string;
};

export type HolderRecord = {
  version: typeof HOLDER_RECORD_VERSION;
  pid: number;
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

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readHolderRecord(profileDir = defaultProfileDir()): Promise<HolderRecord | undefined> {
  try {
    const parsed = JSON.parse(await readFile(holderRecordPath(profileDir), "utf8")) as Partial<HolderRecord>;
    if (
      parsed?.version === HOLDER_RECORD_VERSION &&
      typeof parsed.pid === "number" &&
      typeof parsed.verifiedAt === "string" &&
      typeof parsed.origin === "string"
    ) {
      return parsed as HolderRecord;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function clearHolderFiles(profileDir = defaultProfileDir()): Promise<void> {
  await rm(holderRecordPath(profileDir), { force: true }).catch(() => undefined);
  await rm(holderSeedPath(profileDir), { force: true }).catch(() => undefined);
}

/** A holder is running only when its record exists and the PID is alive. */
export async function holderStatus(
  profileDir = defaultProfileDir(),
): Promise<{ running: boolean; record?: HolderRecord }> {
  const record = await readHolderRecord(profileDir);
  if (record && isProcessAlive(record.pid)) {
    return { running: true, record };
  }
  if (record) {
    await clearHolderFiles(profileDir);
  }
  return { running: false };
}

export async function stopSessionHolder(profileDir = defaultProfileDir()): Promise<boolean> {
  const { running, record } = await holderStatus(profileDir);
  if (!running || !record) {
    return false;
  }
  try {
    process.kill(record.pid);
  } catch {
    // Already gone; cleanup below.
  }
  for (let attempt = 0; attempt < 20 && isProcessAlive(record.pid); attempt += 1) {
    await delay(250);
  }
  await clearHolderFiles(profileDir);
  return true;
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
  const seedFile = holderSeedPath(profileDir);
  // Transient handoff: the holder reads and unlinks this before launching Chrome.
  await writeFile(seedFile, JSON.stringify(options.seed), { encoding: "utf8", mode: 0o600 });
  const spawnHolder = options.spawnHolder ?? defaultHolderSpawn;
  spawnHolder(seedFile)?.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 45_000);
  while (Date.now() < deadline) {
    await delay(300);
    const status = await holderStatus(profileDir);
    if (status.running && status.record?.verifiedAt) {
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
    const record: HolderRecord = {
      version: HOLDER_RECORD_VERSION,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
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
