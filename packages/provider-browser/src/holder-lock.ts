import { randomUUID } from "node:crypto";
import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AdamError, throwIfCancelled } from "adam-core";

export const HOLDER_LIFECYCLE_LOCK = ".adam-holder-lifecycle";
export const HOLDER_MUTATION_LOCK = ".adam-holder-mutation";

// Locks are never stolen using PID or age guesses. A crashed owner requires
// explicit recovery after all processes using this profile have been stopped.
async function acquire(profileDir: string, name: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const path = join(profileDir, name);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    throwIfCancelled(signal);
    try {
      await mkdir(path, { mode: 0o700 });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new AdamError("provider_unavailable", "ADAM session ownership is busy or requires recovery. Stop all ADAM MCP processes before recovering the dedicated profile locks; never remove a lock while another client is running.", false);
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
    return await work(generation);
  } finally {
    // Publication checks the capability under the same short lock. Revoke it
    // before admitting another lifecycle operation, including after timeout.
    await withHolderMutation(profileDir, async () => {
      try {
        await readFile(join(lock, "recovery-required"));
        return; // Preserve the entire claim until explicit stopped-process recovery.
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await unlink(join(lock, "owner")).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      await rmdir(lock);
    });
  }
}
