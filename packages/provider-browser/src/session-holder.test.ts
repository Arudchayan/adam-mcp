import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createPlaywrightSession } from "./playwright-session.ts";
import {
  boundHolderPid,
  clearHolderFiles,
  devToolsActivePortPath,
  holderRecordPath,
  holderStatus,
  isProcessAlive,
  matchesProcessIdentity,
  readHolderRecord,
  readProcessIdentity,
  setNativeIdentityProbeForTests,
  startSessionHolder,
  stopSessionHolder,
  type HolderRecord,
} from "./session-holder.ts";

/**
 * Holder-logic suites bind records through a synthetic identity probe so the
 * Windows PowerShell probe (seconds under load) cannot flip a live holder to
 * stale. Liveness stays real (`process.kill(pid, 0)`), so dead or killed
 * children still read as gone. The real probe is covered separately below.
 */
const syntheticIdentity = (pid: number) => ({ pid, startTime: `synthetic-start-${pid}`, exe: "synthetic-node" });

function useSyntheticIdentityProbe(): void {
  before(() => setNativeIdentityProbeForTests(syntheticIdentity));
  after(() => setNativeIdentityProbeForTests(undefined));
}

async function tempProfile(): Promise<string> {
  return mkdtemp(join(tmpdir(), "adam-holder-"));
}

function keepAlive(): ReturnType<typeof spawn> {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
}

/** Only disposable children created by this test file; never stored profile PIDs. */
async function terminateTestChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.ref();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      child.removeListener("exit", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", finish);
      child.unref();
      reject(new Error("Disposable holder test child did not exit after SIGKILL"));
    }, 10_000);
    // Subscribe before signalling: kill() requests termination, not completion.
    child.once("exit", finish);
    child.kill("SIGKILL");
  });
}

function ignoreSigtermDetached(): ReturnType<typeof spawn> {
  return spawn(
    process.execPath,
    ["-e", `process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`],
    { detached: true, stdio: "ignore" },
  );
}

async function writeBoundRecord(
  profileDir: string,
  child: { pid?: number },
  overrides: Partial<HolderRecord> = {},
): Promise<HolderRecord> {
  const pid = child.pid;
  assert.equal(typeof pid, "number");
  const identity = readProcessIdentity(pid!);
  assert.ok(identity, "expected portable process identity for test child");
  const record: HolderRecord = {
    version: 2,
    generation: "test-generation",
    startedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    origin: "https://adam.unibas.ch",
    ...overrides,
    // Bind to the live child unless the caller intentionally forges identity.
    pid: overrides.pid ?? pid!,
    pidStartTime: overrides.pidStartTime ?? identity.startTime,
    exe: overrides.exe ?? identity.exe,
  };
  await writeFile(holderRecordPath(profileDir), JSON.stringify(record), "utf8");
  return record;
}

describe("session holder records", () => {
  useSyntheticIdentityProbe();

  it("detects a live holder and clears a stale record", async () => {
    const profileDir = await tempProfile();
    try {
      const child = keepAlive();
      try {
        await writeBoundRecord(profileDir, child);
        const live = await holderStatus(profileDir);
        assert.equal(live.running, true);
        assert.equal(live.record?.pid, child.pid);
        assert.equal(boundHolderPid(live), child.pid);
        assert.equal(isProcessAlive(child.pid!), true);
      } finally {
        await terminateTestChild(child);
      }
      // A record whose PID is gone is stale and must be cleaned up.
      await writeFile(
        holderRecordPath(profileDir),
        JSON.stringify({
          version: 2,
          pid: 999_999_999,
          generation: "dead",
          pidStartTime: "0",
          exe: "/nonexistent",
          startedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          origin: "https://adam.unibas.ch",
        }),
        "utf8",
      );
      const stale = await holderStatus(profileDir);
      assert.equal(stale.running, false);
      assert.equal(boundHolderPid(stale), undefined);
      assert.equal(await readHolderRecord(profileDir), undefined);
    } finally {
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("stops a live holder and clears its files", async () => {
    const profileDir = await tempProfile();
    const child = keepAlive();
    try {
      await writeBoundRecord(profileDir, child);
      const stopped = await stopSessionHolder(profileDir);
      assert.equal(stopped, true);
      assert.equal(await readHolderRecord(profileDir), undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(isProcessAlive(child.pid!), false);
    } finally {
      await terminateTestChild(child);
      await clearHolderFiles(profileDir);
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the holder never verifies", async () => {
    const profileDir = await tempProfile();
    try {
      await assert.rejects(
        () =>
          startSessionHolder({
            profileDir,
            seed: { cookies: [] },
            spawnHolder: () => undefined,
            timeoutMs: 400,
          }),
        (error: unknown) => error instanceof AdamError && error.code === "provider_unavailable",
      );
      assert.equal(await readHolderRecord(profileDir), undefined);
    } finally {
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("re-login stops a prior holder and returns a new generation/pid", async () => {
    const profileDir = await tempProfile();
    const oldChild = keepAlive();
    let newChild: ReturnType<typeof spawn> | undefined;
    try {
      const oldRecord = await writeBoundRecord(profileDir, oldChild, {
        generation: "old-generation",
        startedAt: "2020-01-01T00:00:00.000Z",
        verifiedAt: "2020-01-01T00:00:00.000Z",
      });

      const record = await startSessionHolder({
        profileDir,
        seed: { cookies: [] },
        timeoutMs: 5_000,
        spawnHolder: (seedFile) => {
          const seed = JSON.parse(readFileSync(seedFile, "utf8")) as { generation?: string };
          newChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            detached: true,
            stdio: "ignore",
          });
          const pid = newChild.pid;
          assert.equal(typeof pid, "number");
          const identity = readProcessIdentity(pid!);
          assert.ok(identity, "expected portable process identity for new holder");
          const now = new Date().toISOString();
          writeFileSync(
            holderRecordPath(profileDir),
            JSON.stringify({
              version: 2,
              pid,
              generation: seed.generation,
              pidStartTime: identity.startTime,
              exe: identity.exe,
              startedAt: now,
              verifiedAt: now,
              origin: "https://adam.unibas.ch",
            }),
            "utf8",
          );
          try {
            unlinkSync(seedFile);
          } catch {
            // Seed already consumed.
          }
          return newChild;
        },
      });

      assert.notEqual(record.generation, oldRecord.generation);
      assert.notEqual(record.pid, oldChild.pid);
      assert.notEqual(record.startedAt, oldRecord.startedAt);
      assert.equal(isProcessAlive(oldChild.pid!), false);
      assert.equal(record.pid, newChild?.pid);
    } finally {
      const terminations = await Promise.allSettled(
        [oldChild, ...(newChild ? [newChild] : [])].map(terminateTestChild),
      );
      const failures = terminations.filter((result) => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Holder test child cleanup failed");
      await clearHolderFiles(profileDir);
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("escalates SIGTERM hang and clears DevToolsActivePort before reporting stopped", async () => {
    const profileDir = await tempProfile();
    const child = ignoreSigtermDetached();
    child.unref();
    try {
      assert.equal(typeof child.pid, "number");
      await writeBoundRecord(profileDir, child);
      await writeFile(devToolsActivePortPath(profileDir), "9\n/devtools/browser/deadbeef", "utf8");

      const stopped = await stopSessionHolder(profileDir);
      assert.equal(stopped, true);
      assert.equal(isProcessAlive(child.pid!), false);
      assert.equal(await readHolderRecord(profileDir), undefined);
      await assert.rejects(() => access(devToolsActivePortPath(profileDir)));
    } finally {
      await terminateTestChild(child);
      await clearHolderFiles(profileDir);
      await rm(devToolsActivePortPath(profileDir), { force: true }).catch(() => undefined);
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("does not kill a reused PID that fails the identity bind", async () => {
    const profileDir = await tempProfile();
    const stranger = keepAlive();
    try {
      assert.equal(typeof stranger.pid, "number");
      const identity = readProcessIdentity(stranger.pid!);
      assert.ok(identity);
      await writeFile(
        holderRecordPath(profileDir),
        JSON.stringify({
          version: 2,
          pid: stranger.pid!,
          generation: "stale-reuse",
          // Deliberately wrong bind — same PID number, different process identity.
          pidStartTime: "1",
          exe: "/tmp/not-the-real-holder-exe",
          startedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          origin: "https://adam.unibas.ch",
        } satisfies HolderRecord),
        "utf8",
      );

      const stopped = await stopSessionHolder(profileDir);
      assert.equal(stopped, false);
      assert.equal(isProcessAlive(stranger.pid!), true);
      assert.equal(await readHolderRecord(profileDir), undefined);
      assert.equal(boundHolderPid(await holderStatus(profileDir)), undefined);
      // Identity still matches the live stranger — we must not have signaled it.
      assert.deepEqual(readProcessIdentity(stranger.pid!), identity);
    } finally {
      await terminateTestChild(stranger);
      await clearHolderFiles(profileDir);
      await rm(profileDir, { recursive: true, force: true });
    }
  });
});

describe("headless session contract", () => {
  it("reports login-required without launching a browser when no holder exists", async () => {
    const profileDir = await tempProfile();
    try {
      const session = createPlaywrightSession({ profileDir, origin: "https://adam.unibas.ch" });
      const status = await session.status();
      assert.equal(status.loggedIn, false);
      assert.equal(status.reason, "login-required");
      assert.match(status.message ?? "", /adam-mcp login/);
      assert.equal(status.holderPid, null);
      assert.equal(await session.exportSessionState(), undefined);
      await session.close();
    } finally {
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("reports login-required when the CDP endpoint is stale", async () => {
    const profileDir = await tempProfile();
    try {
      await writeFile(join(profileDir, "DevToolsActivePort"), "9\n/devtools/browser/deadbeef", "utf8");
      const session = createPlaywrightSession({ profileDir, origin: "https://adam.unibas.ch" });
      const status = await session.status();
      assert.equal(status.loggedIn, false);
      assert.equal(status.reason, "login-required");
      assert.equal(status.holderPid, null);
      await session.close();
    } finally {
      await rm(profileDir, { recursive: true, force: true });
    }
  });
});

describe("holderPid honesty", () => {
  useSyntheticIdentityProbe();

  it("status reports non-null holderPid matching the bound live holder", async () => {
    const profileDir = await tempProfile();
    const child = keepAlive();
    try {
      const record = await writeBoundRecord(profileDir, child);
      const holder = await holderStatus(profileDir);
      assert.equal(holder.running, true);
      assert.equal(boundHolderPid(holder), record.pid);
      assert.equal(boundHolderPid(holder), child.pid);

      const session = createPlaywrightSession({ profileDir, origin: "https://adam.unibas.ch" });
      const status = await session.status();
      assert.notEqual(status.holderPid, null);
      assert.equal(status.holderPid, child.pid);
      assert.equal(status.holderPid, record.pid);
      await session.close();
    } finally {
      await terminateTestChild(child);
      await clearHolderFiles(profileDir);
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("status reports null holderPid for a dead holder without claiming it is alive", async () => {
    const profileDir = await tempProfile();
    try {
      await writeFile(
        holderRecordPath(profileDir),
        JSON.stringify({
          version: 2,
          pid: 999_999_999,
          generation: "dead",
          pidStartTime: "0",
          exe: "/nonexistent",
          startedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          origin: "https://adam.unibas.ch",
        } satisfies HolderRecord),
        "utf8",
      );
      const holder = await holderStatus(profileDir);
      assert.equal(holder.running, false);
      assert.equal(boundHolderPid(holder), undefined);

      const session = createPlaywrightSession({ profileDir, origin: "https://adam.unibas.ch" });
      const status = await session.status();
      assert.equal(status.holderPid, null);
      assert.notEqual(status.reason, "signed-in");
      await session.close();
    } finally {
      await clearHolderFiles(profileDir);
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("status does not claim holderPid for a reused PID that fails the identity bind", async () => {
    const profileDir = await tempProfile();
    const stranger = keepAlive();
    try {
      assert.equal(typeof stranger.pid, "number");
      await writeFile(
        holderRecordPath(profileDir),
        JSON.stringify({
          version: 2,
          pid: stranger.pid!,
          generation: "stale-reuse",
          pidStartTime: "1",
          exe: "/tmp/not-the-real-holder-exe",
          startedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          origin: "https://adam.unibas.ch",
        } satisfies HolderRecord),
        "utf8",
      );
      const holder = await holderStatus(profileDir);
      assert.equal(holder.running, false);
      assert.equal(boundHolderPid(holder), undefined);
      assert.equal(isProcessAlive(stranger.pid!), true);

      const session = createPlaywrightSession({ profileDir, origin: "https://adam.unibas.ch" });
      const status = await session.status();
      assert.equal(status.holderPid, null);
      assert.equal(isProcessAlive(stranger.pid!), true);
      await session.close();
    } finally {
      await terminateTestChild(stranger);
      await clearHolderFiles(profileDir);
      await rm(profileDir, { recursive: true, force: true });
    }
  });
});

describe("native process identity probe", () => {
  // Exercises the real OS probe (PowerShell on Windows, /proc on Linux). On a
  // saturated Windows machine PowerShell can miss its 3 s production timeout
  // for minutes, so poll within a bounded window. A probe that answers
  // "unknown" quickly is a real regression and fails; only a window in which
  // every miss ran into the native timeout is reported as a skip.
  const NATIVE_TIMEOUT_FLOOR_MS = 2_500;
  const WINDOW_MS = 60_000;

  type Poll<T> = { value?: T; onlySlowMisses: boolean };

  async function poll<T>(read: () => T | undefined, timeoutMs = WINDOW_MS): Promise<Poll<T>> {
    const deadline = Date.now() + timeoutMs;
    let onlySlowMisses = true;
    for (;;) {
      const started = Date.now();
      const value = read();
      if (value !== undefined) return { value, onlySlowMisses };
      if (Date.now() - started < NATIVE_TIMEOUT_FLOOR_MS) onlySlowMisses = false;
      if (Date.now() >= deadline) return { onlySlowMisses };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  it("binds a live child, rejects a forged bind, and drops the child once it exits", { timeout: 150_000 }, async (t) => {
    const child = keepAlive();
    try {
      assert.equal(typeof child.pid, "number");
      const bound = await poll(() => readProcessIdentity(child.pid!));
      const matched = bound.value
        ? await poll(() => matchesProcessIdentity(child.pid!, bound.value!) || undefined)
        : undefined;
      const missed = !bound.value ? bound : matched && !matched.value ? matched : undefined;
      if (missed?.onlySlowMisses) {
        t.skip(`native identity probe timed out on every attempt for ${WINDOW_MS / 1000} s (machine saturated)`);
        return;
      }
      const identity = bound.value;
      assert.ok(identity, "expected the native probe to identify a live test child");
      assert.equal(identity.pid, child.pid);
      assert.ok(identity.startTime.length > 0);
      assert.ok(identity.exe.length > 0);
      assert.equal(matched?.value, true, "expected the same live child to match its own identity");
      // A forged start time / exe never matches, however slow the probe is.
      assert.equal(matchesProcessIdentity(child.pid!, { startTime: "1", exe: "/tmp/not-the-real-holder-exe" }), false);
    } finally {
      await terminateTestChild(child);
    }
    const gone = await poll(() => (readProcessIdentity(child.pid!) === undefined ? true : undefined), 10_000);
    assert.equal(gone.value, true, "an exited child must not keep a process identity");
  });
});
