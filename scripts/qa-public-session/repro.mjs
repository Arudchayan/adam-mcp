// Intentional failing assertions. Run separately from normal test discovery.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSessionHolder, holderSeedPath } from "../../packages/provider-browser/src/session-holder.ts";
import { SharedOperation } from "../../packages/provider-browser/src/request-lifecycle.ts";
import { createPlaywrightSession } from "../../packages/provider-browser/src/playwright-session.ts";
import { chromium } from "playwright-core";

beforeEach((t) => {
  const forbidden = () => { throw new Error("real process, network and browser access prohibited by repro"); };
  t.mock.method(process, "kill", forbidden);
  t.mock.method(globalThis, "fetch", forbidden);
  t.mock.method(chromium, "connectOverCDP", forbidden);
  t.mock.method(chromium, "launchPersistentContext", forbidden);
});

test("S2 foreign seed cleanup before CDP", async () => {
  const profileDir = await mkdtemp(join(tmpdir(), "adam-public-seed-"));
  const foreign = JSON.stringify({ generation: "newer-synthetic", cookies: [] });
  try {
    await assert.rejects(startSessionHolder({ profileDir, seed: { cookies: [] }, timeoutMs: 0, spawnHolder: () => {
      // Another start writes its seed after this start's initial stop; its holder
      // has not yet consumed the seed or started CDP. No record is published.
      writeFileSync(holderSeedPath(profileDir), foreign);
      return undefined;
    } }));
    const remaining = await readFile(holderSeedPath(profileDir), "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    assert.equal(remaining, foreign, "failed start removed the other generation's seed");
  } finally { await rm(profileDir, { recursive: true, force: true }); }
});

test("S3 stalled progress callback blocks shared completion", async () => {
  let release;
  const stalled = new Promise((resolve) => { release = resolve; });
  let healthyCompleted = false;
  const operation = new SharedOperation(async (_signal, report) => { await report({ progress: 1 }); return 42; });
  const slow = operation.join(undefined, () => stalled);
  const healthy = operation.join().then(() => { healthyCompleted = true; });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(healthyCompleted, true, "a never-settling callback blocks shared work");
  } finally { release(); await Promise.allSettled([slow, healthy]); }
});

test("S4 later aborted login subscriber inherits success", async () => {
  const profileDir = await mkdtemp(join(tmpdir(), "adam-public-login-"));
  const session = createPlaywrightSession({ profileDir });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  session.status = async () => { await gate; return { loggedIn: true, origin: "https://adam.unibas.ch" }; };
  try {
    const first = session.loginInteractively();
    const controller = new AbortController();
    controller.abort();
    const second = session.loginInteractively(undefined, { signal: controller.signal });
    const rejected = assert.rejects(second, (error) => error.code === "cancelled");
    release();
    await first;
    await rejected;
  } finally { release(); await session.close(); await rm(profileDir, { recursive: true, force: true }); }
});
