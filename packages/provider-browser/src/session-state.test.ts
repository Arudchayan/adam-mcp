import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { inactiveSessionStatus } from "./session-state.ts";
import { disableSession, sessionDisabled } from "./session-disabled.ts";

it("passive session state never treats a saved profile as verified authentication", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adam-state-"));
  try {
    const saved = await inactiveSessionStatus(dir);
    assert.equal(saved.connectionState, "disconnected");
    assert.match(saved.message!, /unverified/);
    const missing = await inactiveSessionStatus(join(dir, "absent"));
    assert.match(missing.message!, /Sign in to connect/);
    await disableSession(dir);
    const disabled = await inactiveSessionStatus(dir);
    assert.equal(disabled.connectionState, "signed-out");
    assert.equal(disabled.recoveryAction, "login");
    await disableSession(dir, "login-failed");
    const failed = await inactiveSessionStatus(dir);
    assert.equal(failed.connectionState, "disconnected");
    assert.match(failed.message!, /previous sign-in did not complete/);
    assert.equal(await sessionDisabled(dir), true, "failed login still prevents automatic resume");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
