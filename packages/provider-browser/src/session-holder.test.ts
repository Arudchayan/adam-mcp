import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createPlaywrightSession } from "./playwright-session.ts";
import {
  clearHolderFiles,
  holderRecordPath,
  holderStatus,
  isProcessAlive,
  readHolderRecord,
  startSessionHolder,
  stopSessionHolder,
} from "./session-holder.ts";

async function tempProfile(): Promise<string> {
  return mkdtemp(join(tmpdir(), "adam-holder-"));
}

function keepAlive(): ReturnType<typeof spawn> {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
}

describe("session holder records", () => {
  it("detects a live holder and clears a stale record", async () => {
    const profileDir = await tempProfile();
    try {
      const child = keepAlive();
      try {
        await writeFile(
          holderRecordPath(profileDir),
          JSON.stringify({
            version: 1,
            pid: child.pid,
            startedAt: new Date().toISOString(),
            verifiedAt: new Date().toISOString(),
            origin: "https://adam.unibas.ch",
          }),
          "utf8",
        );
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
          version: 1,
          pid: 999_999_999,
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
      await writeFile(
        holderRecordPath(profileDir),
        JSON.stringify({
          version: 1,
          pid: child.pid,
          startedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          origin: "https://adam.unibas.ch",
        }),
        "utf8",
      );
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
