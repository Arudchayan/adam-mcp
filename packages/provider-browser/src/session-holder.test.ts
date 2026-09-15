import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createPlaywrightSession } from "./playwright-session.ts";
import {
  clearHolderFiles,
  devToolsActivePortPath,
  holderRecordPath,
  holderStatus,
  isProcessAlive,
  readHolderRecord,
  readProcessIdentity,
  startSessionHolder,
  stopSessionHolder,
  type HolderRecord,
} from "./session-holder.ts";

async function tempProfile(): Promise<string> {
  return mkdtemp(join(tmpdir(), "adam-holder-"));
}

function keepAlive(): ReturnType<typeof spawn> {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
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
  // Windows identity probes (WMIC/PowerShell) can lag briefly after spawn.
  let identity = readProcessIdentity(pid!);
  for (let attempt = 0; !identity && attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    identity = readProcessIdentity(pid!);
  }
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
  it("detects a live holder and clears a stale record", async () => {
    const profileDir = await tempProfile();
    try {
      const child = keepAlive();
      try {
        await writeBoundRecord(profileDir, child);
        const live = await holderStatus(profileDir);
        assert.equal(live.running, true);
        assert.equal(live.record?.pid, child.pid);
        assert.equal(isProcessAlive(child.pid!), true);
      } finally {
        child.kill();
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
      child.kill();
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
          let identity = readProcessIdentity(pid!);
          const deadline = Date.now() + 1_000;
          while (!identity && Date.now() < deadline) {
            const start = Date.now();
            while (Date.now() - start < 100) {
              // spin — spawnHolder is synchronous
            }
            identity = readProcessIdentity(pid!);
          }
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
      oldChild.kill();
      if (newChild?.pid && isProcessAlive(newChild.pid)) {
        try {
          process.kill(-newChild.pid, "SIGKILL");
        } catch {
          newChild.kill("SIGKILL");
        }
      }
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
      if (child.pid && isProcessAlive(child.pid)) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
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
      // Identity still matches the live stranger — we must not have signaled it.
      assert.deepEqual(readProcessIdentity(stranger.pid!), identity);
    } finally {
      stranger.kill();
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
      await session.close();
    } finally {
      await rm(profileDir, { recursive: true, force: true });
    }
  });
});
