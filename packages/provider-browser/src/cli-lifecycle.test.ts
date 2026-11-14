import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { HOLDER_LIFECYCLE_LOCK, abandonedLockReason, withHolderLifecycle } from "./holder-lock.ts";
import { reconcileHolderProbe } from "./playwright-session.ts";
import type { HolderRecord } from "./session-holder.ts";
import type { AdamBrowserSession } from "./session-types.ts";
import { runStatusCli, statusFromProbeFailure } from "./status-cli.ts";

const record = (verifiedAt: string): HolderRecord => ({
  version: 2, pid: 424242, generation: "g", pidStartTime: "t", exe: "node",
  startedAt: "2026-11-14T00:00:00Z", verifiedAt, origin: "https://adam.unibas.ch",
} as HolderRecord);

describe("#123 post-login status race", () => {
  it("treats a verified holder whose identity re-probe matches as running", () => {
    const observed = { running: false, record: record("2026-11-14T00:00:01Z") };
    assert.deepEqual(reconcileHolderProbe(observed, () => true), { running: true, record: observed.record });
  });

  it("leaves an unverified holder signing in", () => {
    const observed = { running: false, record: record("") };
    assert.equal(reconcileHolderProbe(observed, () => true), observed);
  });

  it("leaves a verified record with a mismatched identity not running", () => {
    const observed = { running: false, record: record("2026-11-14T00:00:01Z") };
    assert.equal(reconcileHolderProbe(observed, () => false), observed);
  });

  it("does not re-probe a holder already reported running", () => {
    const observed = { running: true, record: record("2026-11-14T00:00:01Z") };
    assert.equal(reconcileHolderProbe(observed, () => assert.fail("no re-probe")), observed);
  });
});

describe("#123 status always reports structured JSON", () => {
  it("maps a raw Playwright navigation timeout to a retryable provider_unavailable report", () => {
    const timeout = Object.assign(new Error('page.goto: Timeout 8000ms exceeded.\nCall log:\n  - navigating to "https://adam.unibas.ch/"'), { name: "TimeoutError" });
    const status = statusFromProbeFailure(timeout);
    assert.equal(status.loggedIn, false);
    assert.equal(status.connectionState, "unknown");
    assert.equal(status.recoveryAction, "check_status");
    assert.equal(status.errorCode, "provider_unavailable");
    assert.equal(status.retryable, true);
    assert.doesNotMatch(status.message ?? "", /Call log/, "no raw stack or call log");
  });

  it("maps unauthorized to a login recovery", () => {
    const status = statusFromProbeFailure(new AdamError("unauthorized", "ADAM is showing the login page.", false));
    assert.equal(status.reason, "login-required");
    assert.equal(status.recoveryAction, "login");
    assert.equal(status.retryable, false);
  });

  it("prints one JSON report and exits 1 when status() throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adam-status-fail-"));
    const previous = process.env.ADAM_BROWSER_PROFILE_DIR;
    process.env.ADAM_BROWSER_PROFILE_DIR = dir;
    const logs: string[] = [];
    const originalLog = console.log;
    const originalExit = process.exitCode;
    console.log = (message?: unknown) => { logs.push(String(message)); };
    const session = {
      async status() { throw Object.assign(new Error("page.goto: Timeout 8000ms exceeded."), { name: "TimeoutError" }); },
      async close() { throw new Error("teardown failure"); },
    } as unknown as AdamBrowserSession;
    let exitCode: typeof process.exitCode;
    try {
      await runStatusCli(() => session, []);
      exitCode = process.exitCode;
    } finally {
      console.log = originalLog;
      process.exitCode = originalExit;
      if (previous === undefined) delete process.env.ADAM_BROWSER_PROFILE_DIR;
      else process.env.ADAM_BROWSER_PROFILE_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
    assert.equal(logs.length, 1);
    const report = JSON.parse(logs[0]!) as Record<string, unknown>;
    assert.equal(report.loggedIn, false);
    assert.equal(report.errorCode, "provider_unavailable");
    assert.equal(exitCode, 1);
  });
});

describe("#123 abandoned lifecycle locks fail fast with recovery guidance", () => {
  it("fails immediately on a recovery-required lock and names the lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adam-lock-"));
    try {
      await mkdir(join(dir, HOLDER_LIFECYCLE_LOCK));
      await writeFile(join(dir, HOLDER_LIFECYCLE_LOCK, "owner"), "old");
      await writeFile(join(dir, HOLDER_LIFECYCLE_LOCK, "recovery-required"), "x");
      const started = Date.now();
      await assert.rejects(withHolderLifecycle(dir, async () => assert.fail("must not acquire")), (error: unknown) => {
        assert.ok(error instanceof AdamError);
        assert.match(error.message, /\.adam-holder-lifecycle/);
        assert.match(error.message, /recovery-required/);
        assert.match(error.message, /status --verbose/);
        assert.doesNotMatch(error.message, new RegExp(dir.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")), "no absolute profile path");
        return true;
      });
      assert.ok(Date.now() - started < 5_000, "no 60s wait");
      assert.ok((await readdir(join(dir, HOLDER_LIFECYCLE_LOCK))).includes("owner"), "the lock is never stolen");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("fails fast when the recorded owner process no longer exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adam-lock-"));
    try {
      await mkdir(join(dir, HOLDER_LIFECYCLE_LOCK));
      await writeFile(join(dir, HOLDER_LIFECYCLE_LOCK, "owner"), "old");
      await writeFile(join(dir, HOLDER_LIFECYCLE_LOCK, "owner-pid"), "2147483646");
      const started = Date.now();
      await assert.rejects(withHolderLifecycle(dir, async () => assert.fail("must not acquire")), /process 2147483646, which is no longer running/);
      assert.ok(Date.now() - started < 5_000, "no 60s wait");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("keeps waiting for a lock whose owner is alive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adam-lock-"));
    try {
      await mkdir(join(dir, HOLDER_LIFECYCLE_LOCK));
      await writeFile(join(dir, HOLDER_LIFECYCLE_LOCK, "owner-pid"), String(process.pid));
      assert.equal(await abandonedLockReason(join(dir, HOLDER_LIFECYCLE_LOCK)), undefined);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("records and releases the owner pid with the lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adam-lock-"));
    try {
      await withHolderLifecycle(dir, async () => {
        assert.deepEqual((await readdir(join(dir, HOLDER_LIFECYCLE_LOCK))).sort(), ["owner", "owner-pid"]);
      });
      assert.equal((await readdir(dir)).includes(HOLDER_LIFECYCLE_LOCK), false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
