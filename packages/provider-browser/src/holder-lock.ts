import { randomUUID } from "node:crypto";
import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AdamError, throwIfCancelled } from "adam-core";

export const HOLDER_LIFECYCLE_LOCK = ".adam-holder-lifecycle";
export const HOLDER_MUTATION_LOCK = ".adam-holder-mutation";

const OWNER_PID_FILE = "owner-pid";

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * Why a held lock cannot be released by waiting (#123), or undefined while it
 * may still be released. Diagnostic only: locks are never stolen (ADR 0040).
 */
export async function abandonedLockReason(lockPath: string): Promise<string | undefined> {
  if (await readFile(join(lockPath, "recovery-required")).then(() => true, () => false)) {
    return "is marked recovery-required because a Chrome closure could not be established";
  }
  const pid = Number(await readFile(join(lockPath, OWNER_PID_FILE), "utf8").catch(() => ""));
  if (Number.isInteger(pid) && pid > 0 && !processExists(pid)) {
    return `was left by adam-mcp process ${pid}, which is no longer running`;
  }
  return undefined;
}

function lockError(name: string, reason: string): AdamError {
  return new AdamError(
    "provider_unavailable",
    `ADAM session ownership lock \`${name}\` in the dedicated ADAM profile ${reason}. Stop every adam-mcp process and the dedicated ADAM Chrome, then remove the \`${HOLDER_LIFECYCLE_LOCK}\` and \`${HOLDER_MUTATION_LOCK}\` directories from that profile (\`adam-mcp status --verbose\` shows profileDir; see docs/session-recovery.md). Never remove a lock while another client is running.`,
    false,
  );
}

// Locks are never stolen using PID or age guesses. A crashed owner requires
// explicit recovery after all processes using this profile have been stopped.
// A lock that cannot be released by waiting fails fast with its name (#123).
async function acquire(profileDir: string, name: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const path = join(profileDir, name);
  const deadline = Date.now() + timeoutMs;
  let nextInspection = 0;
  while (true) {
    throwIfCancelled(signal);
    try {
      await mkdir(path, { mode: 0o700 });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (name === HOLDER_LIFECYCLE_LOCK && Date.now() >= nextInspection) {
        nextInspection = Date.now() + 1_000;
        const abandoned = await abandonedLockReason(path);
        if (abandoned) throw lockError(name, abandoned);
      }
      if (Date.now() >= deadline) {
        throw lockError(name, `stayed busy for ${Math.round(timeoutMs / 1000)}s`);
      }
      await delay(25);
    }
  }
}

export async function withHolderMutation<T>(profileDir: string, work: () => Promise<T>): Promise<T> {
  const lock = await acquire(profileDir, HOLDER_MUTATION_LOCK, 2_000);
  try { return await work(); } finally { await rmdir(lock); }
}

export async function lifecycleOwnsGeneration(profileDir: string, generation: string): Promise<boolean> {
  try { return await readFile(join(profileDir, HOLDER_LIFECYCLE_LOCK, "owner"), "utf8") === generation; }
  catch { return false; }
}

export async function revokeHolderGeneration(profileDir: string, generation: string): Promise<void> {
  await withHolderMutation(profileDir, async () => {
    if (await lifecycleOwnsGeneration(profileDir, generation)) {
      await unlink(join(profileDir, HOLDER_LIFECYCLE_LOCK, "owner"));
    }
  });
}

export async function retainHolderLifecycle(profileDir: string, generation: string): Promise<void> {
  await withHolderMutation(profileDir, async () => {
    if (!(await lifecycleOwnsGeneration(profileDir, generation))) throw new AdamError("provider_unavailable", "ADAM lifecycle ownership expired.", false);
    await writeFile(join(profileDir, HOLDER_LIFECYCLE_LOCK, "recovery-required"), "Chrome closure could not be established.", { mode: 0o600 });
  });
}

export async function withHolderLifecycle<T>(profileDir: string, work: (generation: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  await mkdir(profileDir, { recursive: true });
  const lock = await acquire(profileDir, HOLDER_LIFECYCLE_LOCK, 60_000, signal);
  const generation = randomUUID();
  try {
    await writeFile(join(lock, "owner"), generation, { flag: "wx", mode: 0o600 });
    await writeFile(join(lock, OWNER_PID_FILE), String(process.pid), { flag: "wx", mode: 0o600 });
    return await work(generation);
  } finally {
    // Publication checks the capability under the same short lock. Revoke it
    // before admitting another lifecycle operation, including after timeout.
    await withHolderMutation(profileDir, async () => {
      try {
        await readFile(join(lock, "recovery-required"));
        return; // Preserve the entire claim until explicit stopped-process recovery.
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      for (const file of ["owner", OWNER_PID_FILE]) {
        await unlink(join(lock, file)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      }
      await rmdir(lock);
    });
  }
}
