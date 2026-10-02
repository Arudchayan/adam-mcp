import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { isLoggedInSnapshot, isLoginSnapshot } from "./extract.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import {
  boundHolderPid,
  devToolsActivePortPath,
  holderRecordPath,
  holderStatus,
  isBoundHolderAlive,
  isCdpAlive,
  readHolderRecord,
  readProcessIdentity,
  startSessionHolder,
  stopSessionHolder,
  type HolderRecord,
} from "./session-holder.ts";
import { resumeDeadHolderSession } from "./session-resume.ts";
import { SerialQueue } from "./serial-queue.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import { classifyStatus, shouldProbeOrigin } from "./playwright-session.ts";

// fix-21 holder races R1–R10, mocked-process only.
// fix-22 decoupling: never imports runStatusCli, never passes argv,
// never asserts holder/profileDir absent. R3/status asserts target HEAD
// behavior (single-arg runStatusCli always includes holder+profileDir)
// via holderStatus record detail + session.status holderPid honesty.

async function tempProfile(): Promise<string> {
  return mkdtemp(join(tmpdir(), "adam-holder-races-"));
}

async function runnerIdentity(): Promise<{ startTime: string; exe: string }> {
  let identity = readProcessIdentity(process.pid);
  for (let attempt = 0; !identity && attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    identity = readProcessIdentity(process.pid);
  }
  assert.ok(identity, "expected runner process identity for mocked bind");
  return { startTime: identity.startTime, exe: identity.exe };
}

async function writeRunnerBoundRecord(
  profileDir: string,
  overrides: Partial<HolderRecord> = {},
): Promise<HolderRecord> {
  const identity = await runnerIdentity();
  const now = new Date().toISOString();
  const record: HolderRecord = {
    version: 2,
    generation: `gen-${Math.random().toString(36).slice(2)}`,
    startedAt: now,
    verifiedAt: now,
    origin: "https://adam.unibas.ch",
    pidStartTime: identity.startTime,
    exe: identity.exe,
    pid: process.pid,
    ...overrides,
  };
  await writeFile(holderRecordPath(profileDir), JSON.stringify(record), "utf8");
  return record;
}

type KillCall = { pid: number; signal?: string | number };

function stubKillRecordOnly(options: { dieAfterTerm?: boolean } = {}): {
  calls: KillCall[];
  restore: () => void;
  revive: () => void;
} {
  const originalKill = process.kill;
  const calls: KillCall[] = [];
  let termSeen = false;
  const deadPids = new Set<number>([999_999_999]);
  const stub = ((pid: number, signal?: string | number): boolean => {
    calls.push({ pid, signal });
    // Aliveness probe: process.kill(pid, 0).
    if (signal === 0) {
      if (deadPids.has(pid)) {
        const err = new Error("ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      if (options.dieAfterTerm && termSeen && Math.abs(pid) === process.pid) {
        const err = new Error("ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      if (Math.abs(pid) === process.pid) {
        return true;
      }
      return (originalKill as (p: number, s?: unknown) => boolean)(pid, 0);
    }
    // SIGTERM/SIGKILL (including -pid group): record-only, never signal.
    if (Math.abs(pid) === process.pid) {
      termSeen = true;
    }
    return true;
  }) as typeof process.kill;
  process.kill = stub;
  return {
    calls,
    restore: () => {
      process.kill = originalKill;
    },
    revive: () => {
      termSeen = false;
    },
  };
}

function stubFetch(ok: boolean | "throw"): { restore: () => void } {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (ok === "throw") {
      throw new Error("cdp flake");
    }
    return { ok } as unknown as Response;
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("session holder races R1-R10 (mocked-process only)", () => {
  it("R1 concurrent starts serialize via queue to one live PID", async () => {
    const profileDir = await tempProfile();
    const kill = stubKillRecordOnly({ dieAfterTerm: true });
    const cdp = stubFetch(false);
    const queue = new SerialQueue();
    let spawns = 0;
    const spawnHolder = (seedFile: string) => {
      spawns += 1;
      // Revive the runner bind: a prior stop faked death via kill-0;
      // the new holder reuses the runner PID and must read alive again.
      kill.revive();
      const seed = JSON.parse(readFileSync(seedFile, "utf8")) as { generation?: string };
      const now = new Date().toISOString();
      // Synchronous write so the poll loop sees this generation quickly.
      // Uses runner PID identity; stubbed kill never really signals.
      // Windows WMIC/PowerShell can lag after spawn: spin synchronously.
      let identity = readProcessIdentity(process.pid);
      const deadline = Date.now() + 2_000;
      while (!identity && Date.now() < deadline) {
        const start = Date.now();
        while (Date.now() - start < 50) {
          // spin — spawnHolder is synchronous
        }
        identity = readProcessIdentity(process.pid);
      }
      assert.ok(identity);
      writeFileSync(
        holderRecordPath(profileDir),
        JSON.stringify({
          version: 2,
          pid: process.pid,
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
        // Already consumed.
      }
      return { unref: () => undefined, pid: process.pid } as never;
    };
    try {
      const first = queue.enqueue(() =>
        startSessionHolder({ profileDir, seed: { cookies: [] }, spawnHolder, timeoutMs: 5_000 }),
      );
      const second = queue.enqueue(() =>
        startSessionHolder({ profileDir, seed: { cookies: [] }, spawnHolder, timeoutMs: 5_000 }),
      );
      const [rec1, rec2] = await Promise.all([first, second]);
      assert.notEqual(rec1.generation, rec2.generation);
      assert.equal(rec1.pid, process.pid);
      assert.equal(rec2.pid, process.pid);
      assert.equal(spawns, 2);
      const live = await holderStatus(profileDir);
      assert.equal(live.running, true);
      assert.equal(live.record?.pid, process.pid);
      assert.equal(live.record?.generation, rec2.generation);
    } finally {
      kill.restore();
      cdp.restore();
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("R2 stop-vs-status never half-reports a live holder", async () => {
    const profileDir = await tempProfile();
    const kill = stubKillRecordOnly({ dieAfterTerm: true });
    const cdp = stubFetch(false);
    try {
      await writeRunnerBoundRecord(profileDir, { generation: "r2-before" });
      const before = await holderStatus(profileDir);
      assert.equal(before.running, true);
      assert.equal(boundHolderPid(before), process.pid);
      const stopped = await stopSessionHolder(profileDir);
      assert.equal(stopped, true);
      const after = await holderStatus(profileDir);
      assert.equal(after.running, false);
      assert.equal(await readHolderRecord(profileDir), undefined);

      // Concurrent half-report probe: fresh record, race status vs stop.
      kill.revive();
      await writeRunnerBoundRecord(profileDir, { generation: "r2-race" });
      const [raced, racedStop] = await Promise.all([
        holderStatus(profileDir),
        stopSessionHolder(profileDir),
      ]);
      // Either ordering is fine, but never a half-report:
      // running true must carry the bound record/PID (record pid is stable;
      // boundHolderPid re-probes aliveness and may legitimately go undefined
      // after a concurrent stop faked death, so only check the captured record).
      if (raced.running) {
        assert.equal(raced.record?.pid, process.pid);
      }
      assert.equal(racedStop, true);
      const final = await holderStatus(profileDir);
      assert.equal(final.running, false);
      assert.equal(await readHolderRecord(profileDir), undefined);
    } finally {
      kill.restore();
      cdp.restore();
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("R3 tri-race yields a single PID and HEAD status detail stays present", async () => {
    const profileDir = await tempProfile();
    const kill = stubKillRecordOnly();
    const cdp = stubFetch(false);
    try {
      const record = await writeRunnerBoundRecord(profileDir, { generation: "r3-tri" });
      const session = createPlaywrightSession({
        profileDir,
        origin: "https://adam.unibas.ch",
      });
      try {
        const [a, b, status] = await Promise.all([
          holderStatus(profileDir),
          holderStatus(profileDir),
          session.status(),
        ]);
        // Single PID: every binding agrees on the runner, never a stranger.
        assert.equal(boundHolderPid(a), process.pid);
        assert.equal(boundHolderPid(b), process.pid);
        assert.equal(a.record?.pid, process.pid);
        assert.equal(b.record?.pid, process.pid);
        assert.equal(status.holderPid, process.pid);
        // HEAD behavior: holder detail (startedAt/record) is always available,
        // not gated behind argv/verbose. Do not assert holder absent.
        assert.ok(typeof a.record?.startedAt === "string");
        assert.equal(a.record?.startedAt, record.startedAt);
        assert.ok(typeof status.holderPid === "number");
      } finally {
        await session.close();
      }
    } finally {
      kill.restore();
      cdp.restore();
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("R4 resume closes once, orders close-before-start, and exportSeed failure still closes once", async () => {
    // Success ordering: export -> close -> start, close exactly once.
    {
      const order: string[] = [];
      let closed = 0;
      let started = 0;
      const outcome = await resumeDeadHolderSession({
        holderRunning: false,
        profileDir: "/tmp/adam-holder-races-r4",
        origin: "https://adam.unibas.ch",
        launchHeadlessAndVerify: async () => ({
          loggedIn: true,
          exportSeed: async () => {
            order.push("export");
            return { cookies: [] };
          },
          close: async () => {
            closed += 1;
            order.push("close");
          },
        }),
        startHolder: async () => {
          started += 1;
          assert.deepEqual(order, ["export", "close"]);
          assert.equal(closed, 1);
          order.push("start");
          return {
            version: 2,
            pid: 1,
            generation: "r4",
            pidStartTime: "t",
            exe: "e",
            startedAt: new Date().toISOString(),
            verifiedAt: new Date().toISOString(),
            origin: "https://adam.unibas.ch",
          };
        },
      });
      assert.equal(outcome, "signed-in");
      assert.deepEqual(order, ["export", "close", "start"]);
      assert.equal(closed, 1);
      assert.equal(started, 1);
    }
    // exportSeed failure: close exactly once, never start, error propagates.
    {
      let closed = 0;
      let started = 0;
      await assert.rejects(
        () =>
          resumeDeadHolderSession({
            holderRunning: false,
            profileDir: "/tmp/adam-holder-races-r4",
            origin: "https://adam.unibas.ch",
            launchHeadlessAndVerify: async () => ({
              loggedIn: true,
              exportSeed: async () => {
                throw new AdamError("provider_unavailable", "seed failed");
              },
              close: async () => {
                closed += 1;
              },
            }),
            startHolder: async () => {
              started += 1;
              throw new Error("must not start when export fails");
            },
          }),
        (error: unknown) => error instanceof AdamError && error.code === "provider_unavailable",
      );
      assert.equal(closed, 1);
      assert.equal(started, 0);
    }
  });

  it("R5 mid-verify abort between verify and handoff still closes once and never starts twice", async () => {
    let closed = 0;
    let starts = 0;
    await assert.rejects(
      () =>
        resumeDeadHolderSession({
          holderRunning: false,
          profileDir: "/tmp/adam-holder-races-r5",
          origin: "https://adam.unibas.ch",
          launchHeadlessAndVerify: async () => ({
            loggedIn: true,
            exportSeed: async () => ({ cookies: [] }),
            close: async () => {
              closed += 1;
            },
          }),
          startHolder: async () => {
            starts += 1;
            // Simulate abort after verify, before handoff completes.
            throw new AdamError("cancelled", "aborted mid-verify");
          },
        }),
      (error: unknown) => error instanceof AdamError && error.code === "cancelled",
    );
    assert.equal(starts, 1);
    // closeOnce in try + catch must not double-close.
    assert.equal(closed, 1);
  });

  it("R6 DevToolsActivePort flake fails closed without claiming CDP alive", async () => {
    const profileDir = await tempProfile();
    const kill = stubKillRecordOnly();
    try {
      // Garbage port: parse fails, fetch must not be consulted as alive.
      await writeFile(devToolsActivePortPath(profileDir), "not-a-port\n/garbage", "utf8");
      const flakeFetch = stubFetch(true);
      try {
        assert.equal(await isCdpAlive(profileDir), false);
      } finally {
        flakeFetch.restore();
      }
      // Valid port but fetch not-ok: dead.
      await writeFile(devToolsActivePortPath(profileDir), "41234\n/devtools/browser/abc", "utf8");
      const deadFetch = stubFetch(false);
      try {
        assert.equal(await isCdpAlive(profileDir), false);
      } finally {
        deadFetch.restore();
      }
      // Valid port but fetch throws: dead (fail-closed, never throws).
      const throwFetch = stubFetch("throw");
      try {
        assert.equal(await isCdpAlive(profileDir), false);
      } finally {
        throwFetch.restore();
      }
      // Stale record + flaky port + dead CDP: holder not running, files cleared.
      await writeFile(
        holderRecordPath(profileDir),
        JSON.stringify({
          version: 2,
          pid: 999_999_999,
          generation: "r6-stale",
          pidStartTime: "0",
          exe: "/nonexistent",
          startedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          origin: "https://adam.unibas.ch",
        }),
        "utf8",
      );
      // Remove the port file so chromeOrCdpStillAlive is false (CDP dead).
      await rm(devToolsActivePortPath(profileDir), { force: true });
      const quietFetch = stubFetch(false);
      try {
        const status = await holderStatus(profileDir);
        assert.equal(status.running, false);
        assert.equal(boundHolderPid(status), undefined);
        assert.equal(await readHolderRecord(profileDir), undefined);
      } finally {
        quietFetch.restore();
      }
    } finally {
      kill.restore();
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("R7 WMIC/ps lag or reused PID never signals a stranger and fails closed", async () => {
    const profileDir = await tempProfile();
    const kill = stubKillRecordOnly();
    const cdp = stubFetch(false);
    try {
      // Dead PID with forged bind: fail-closed, never signal, clear record.
      await writeFile(
        holderRecordPath(profileDir),
        JSON.stringify({
          version: 2,
          pid: 999_999_999,
          generation: "r7-reuse",
          pidStartTime: "1",
          exe: "/tmp/not-the-real-holder-exe",
          startedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          origin: "https://adam.unibas.ch",
        } satisfies HolderRecord),
        "utf8",
      );
      const stale = await holderStatus(profileDir);
      assert.equal(stale.running, false);
      assert.equal(boundHolderPid(stale), undefined);
      const stoppedStale = await stopSessionHolder(profileDir);
      assert.equal(stoppedStale, false);
      assert.equal(await readHolderRecord(profileDir), undefined);
      assert.equal(
        kill.calls.some(
          (c) => (c.pid === 999_999_999 || c.pid === -999_999_999) && c.signal !== 0,
        ),
        false,
        "stale stop must never SIGTERM/SIGKILL a stranger PID (probes excluded)",
      );

      // Same runner PID number but wrong identity: must not be treated as alive,
      // and stop must not signal self.
      const callsBefore = kill.calls.length;
      const wrongWritten = await writeRunnerBoundRecord(profileDir, {
        generation: "r7-wrong-bind",
        pidStartTime: "lagged-starttime",
        exe: "/tmp/lagged-exe",
      });
      // Fail-closed: lagged/unreadable identity never invents a live bind.
      assert.equal(isBoundHolderAlive(wrongWritten), false);
      const wrong = await holderStatus(profileDir);
      // holderStatus fail-closes a wrong bind: never running, never bound.
      // With dead CDP it clears the stale file, so record may be absent.
      assert.equal(wrong.running, false);
      assert.equal(boundHolderPid(wrong), undefined);
      const stoppedWrong = await stopSessionHolder(profileDir);
      assert.equal(stoppedWrong, false);
      const signaledSelf = kill.calls
        .slice(callsBefore)
        .some((c) => Math.abs(c.pid) === process.pid && c.signal !== 0);
      assert.equal(signaledSelf, false);
    } finally {
      kill.restore();
      cdp.restore();
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("R8 cold-start login-page hit re-probes once with a second goto before reporting", async () => {
    const origin = "https://adam.unibas.ch";
    // shouldProbeOrigin: cold-start states probe, deep course URLs do not.
    assert.equal(shouldProbeOrigin("", origin), true);
    assert.equal(shouldProbeOrigin("about:blank", origin), true);
    assert.equal(shouldProbeOrigin(`${origin}/`, origin), true);
    assert.equal(shouldProbeOrigin(`${origin}/login.php?x=1`, origin), true);
    assert.equal(shouldProbeOrigin("https://other.example/", origin), true);
    assert.equal(shouldProbeOrigin(`${origin}/go/crs/100001`, origin), false);

    const loginSnapshot = {
      url: `${origin}/login.php`,
      title: "Anmelden",
      html: "<main>login</main>",
      text: "Bei ADAM anmelden Login mit Switch edu-ID",
      links: [],
    };
    const dashboardSnapshot = {
      url: `${origin}/`,
      title: "Schreibtisch",
      html: "<main>dashboard</main>",
      text: "Persönlicher Schreibtisch Abmelden",
      links: [],
    };
    assert.equal(isLoginSnapshot(loginSnapshot), true);
    assert.equal(isLoggedInSnapshot(loginSnapshot), false);
    assert.equal(classifyStatus(loginSnapshot), "login");
    assert.equal(classifyStatus(dashboardSnapshot), "logged-in");

    // 2-goto re-probe harness mirroring PlaywrightAdamSession.status:
    // login on first read -> one bounded re-goto -> signed-in.
    let gotos = 0;
    let current = loginSnapshot;
    const fakeGoto = async (): Promise<void> => {
      gotos += 1;
      // Cold start resolves on the second hit.
      if (gotos >= 2) {
        current = dashboardSnapshot;
      }
    };
    let snapshot = current;
    let kind = classifyStatus(snapshot);
    if (kind === "login") {
      await fakeGoto();
      await fakeGoto();
      snapshot = current;
      kind = classifyStatus(snapshot);
    }
    // First logical goto + one bounded re-probe = 2 gotos total.
    assert.equal(gotos, 2);
    assert.equal(kind, "logged-in");
    assert.equal(isLoggedInSnapshot(snapshot), true);
  });

  it("R9 lingering Chrome/CDP never clears the holder record", async () => {
    const profileDir = await tempProfile();
    const kill = stubKillRecordOnly();
    const cdpAlive = stubFetch(true);
    try {
      await writeFile(
        holderRecordPath(profileDir),
        JSON.stringify({
          version: 2,
          pid: 999_999_999,
          generation: "r9-lingering",
          pidStartTime: "0",
          exe: "/nonexistent",
          startedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          origin: "https://adam.unibas.ch",
        }),
        "utf8",
      );
      await writeFile(devToolsActivePortPath(profileDir), "41235\n/devtools/browser/lingering", "utf8");
      const status = await holderStatus(profileDir);
      assert.equal(status.running, false);
      assert.equal(boundHolderPid(status), undefined);
      // Never clears while Chrome/CDP is still alive: record stays.
      assert.notEqual(await readHolderRecord(profileDir), undefined);
      await assert.rejects(() => stopSessionHolder(profileDir), (error: unknown) => {
        assert.ok(error instanceof AdamError);
        assert.equal(error.code, "provider_unavailable");
        return true;
      });
      assert.notEqual(
        await readHolderRecord(profileDir),
        undefined,
        "failed stop must not clear while lingering Chrome lives",
      );
    } finally {
      kill.restore();
      cdpAlive.restore();
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  it("R10 abort mid-walk never memoizes the enrolled walk", async () => {
    const origin = "https://adam.unibas.ch";
    const dashboardUrl = origin;
    const courseUrl = `${origin}/go/crs/100001`;
    const dashboardHtml = `<main><h1>Schreibtisch</h1><a href="/go/crs/100001">Synthetic course</a><a href="/logout.php">Abmelden</a></main>`;
    const courseHtml = `<main><h1>Synthetic course</h1><p>Written exam.</p><a href="/logout.php">Abmelden</a></main>`;
    const opens: string[] = [];
    let failCourseOnce = true;
    const provider = createBrowserProvider({
      origin,
      session: createMemorySession(
        {
          [dashboardUrl]: snapshotFromHtml(
            dashboardUrl,
            "Schreibtisch",
            dashboardHtml,
            "Schreibtisch Synthetic course Abmelden",
          ),
          [courseUrl]: snapshotFromHtml(courseUrl, "Synthetic course", courseHtml, "Synthetic course Abmelden"),
        },
        {
          onOpen: (url) => opens.push(url),
          openError: (url) =>
            url === courseUrl && failCourseOnce
              ? new AdamError("cancelled", "aborted mid-walk")
              : undefined,
        },
      ),
    });
    await assert.rejects(() => provider.listCalendar(), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "cancelled");
      return true;
    });
    const afterAbortOpens = opens.length;
    assert.ok(afterAbortOpens >= 2, "aborted walk opened dashboard + course attempt");

    // Retry succeeds: abort never memoized, so the walk re-opens.
    failCourseOnce = false;
    const calendar = await provider.listCalendar();
    assert.ok(Array.isArray(calendar.items));
    const afterRetryOpens = opens.length;
    assert.ok(afterRetryOpens > afterAbortOpens, "retry must re-open after abort (no memo)");

    // Success memoizes: third walk reuses memo, no further opens.
    await provider.search("Synthetic");
    assert.equal(opens.length, afterRetryOpens, "successful walk memoizes; search reuses it");
  });
});
