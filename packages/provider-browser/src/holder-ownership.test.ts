import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { createPlaywrightSession } from "./playwright-session.ts";
import { HOLDER_LIFECYCLE_LOCK, lifecycleOwnsGeneration, revokeHolderGeneration, withHolderLifecycle, withHolderMutation } from "./holder-lock.ts";
import { devToolsActivePortPath, holderRecordPath, holderSeedPath, holderStatus, runSessionHolder, startSessionHolder, stopSessionHolder } from "./session-holder.ts";

test("failed startup preserves a foreign fixed-path handoff", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-"));
  t.mock.method(process, "kill", () => { throw new Error("unexpected signal"); });
  const foreign = JSON.stringify({ generation: "foreign", cookies: [] });
  try {
    await assert.rejects(startSessionHolder({ profileDir: directory, seed: { cookies: [] }, timeoutMs: 0,
      spawnHolder: () => { writeFileSync(holderSeedPath(directory), foreign); return undefined; } }));
    assert.equal(await readFile(holderSeedPath(directory), "utf8"), foreign);
    assert.deepEqual(await readdir(directory), ["session-seed.json"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("status preserves a replacement published during its CDP probe", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-"));
  const record = (generation: string) => JSON.stringify({ version: 2, pid: 987654321, generation,
    pidStartTime: "synthetic", exe: "synthetic", startedAt: "synthetic", verifiedAt: "synthetic", origin: "https://adam.unibas.ch" });
  const foreign = record("foreign");
  t.mock.method(process, "kill", () => { throw new Error("dead"); });
  t.mock.method(globalThis, "fetch", async () => { await writeFile(holderRecordPath(directory), foreign); return { ok: false }; });
  try {
    await writeFile(holderRecordPath(directory), record("old"));
    await writeFile(devToolsActivePortPath(directory), "41234\n/devtools/browser/synthetic");
    await holderStatus(directory);
    assert.equal(await readFile(holderRecordPath(directory), "utf8"), foreign);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a legacy pending seed refuses startup without overwriting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-"));
  try {
    await writeFile(holderSeedPath(directory), "legacy-pending");
    await assert.rejects(startSessionHolder({ profileDir: directory, seed: { cookies: [] },
      spawnHolder: () => { throw new Error("must not spawn"); } }), /older ADAM session handoff/);
    assert.equal(await readFile(holderSeedPath(directory), "utf8"), "legacy-pending");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("revocation prevents a delayed child from consuming a handoff or launching Chrome", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-"));
  try {
    await withHolderLifecycle(directory, async (generation) => {
      const seed = holderSeedPath(directory, generation);
      await writeFile(seed, JSON.stringify({ generation, cookies: [] }));
      await revokeHolderGeneration(directory, generation);
      assert.equal(await lifecycleOwnsGeneration(directory, generation), false);
      await assert.rejects(runSessionHolder(seed), /no longer owns startup/);
      await access(seed);
      await assert.rejects(access(holderRecordPath(directory)));
    });
    await assert.rejects(access(join(directory, HOLDER_LIFECYCLE_LOCK)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a killed holder with an unresolved Chrome launch blocks replacement until shutdown acknowledgement", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-launch-"));
  const generation = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const record = JSON.stringify({ version: 2, pid: 987654321, generation,
    pidStartTime: "synthetic", exe: "synthetic", startedAt: "synthetic", verifiedAt: "",
    origin: "https://adam.unibas.ch", launchPending: true });
  t.mock.method(process, "kill", () => { throw new Error("dead holder, browser launch unresolved"); });
  let spawned = false;
  try {
    await writeFile(holderRecordPath(directory), record);
    const status = await holderStatus(directory);
    assert.equal(status.running, false);
    assert.equal(await readFile(holderRecordPath(directory), "utf8"), record);
    await assert.rejects(stopSessionHolder(directory), /no shutdown acknowledgement/);
    await assert.rejects(startSessionHolder({ profileDir: directory, seed: { cookies: [] },
      spawnHolder: () => { spawned = true; return undefined; } }), /no shutdown acknowledgement/);
    assert.equal(spawned, false);
    assert.equal(await readFile(holderRecordPath(directory), "utf8"), record);
    const session = createPlaywrightSession({ profileDir: directory });
    for (const method of ["tryAttachCdp", "resumeDeadHolderOrUnauthorized", "launchHeadlessResumeAndVerify"]) {
      await assert.rejects(Reflect.get(session, method).call(session), /prior ADAM browser launch/);
    }
    await session.close();
    // Only the generation's holder writes this after launch settles and Chrome
    // closes. Absence of CDP alone is deliberately not treated as that proof.
    await writeFile(join(directory, `session-stopped-${generation}.json`), generation);
    await holderStatus(directory);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a valid child consumes its own seed and publishes pending ownership before launch", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-valid-"));
  const handlers = new Map((["SIGTERM", "SIGINT"] as const).map((name) => [name, new Set(process.listeners(name))]));
  let launched = false;
  t.mock.method(chromium, "launchPersistentContext", async () => {
    launched = true;
    const record = JSON.parse(await readFile(holderRecordPath(directory), "utf8"));
    assert.equal(record.launchPending, true);
    assert.equal(record.verifiedAt, "");
    throw new Error("synthetic launch failure");
  });
  try {
    await withHolderLifecycle(directory, async (generation) => {
      const seed = holderSeedPath(directory, generation);
      await writeFile(seed, JSON.stringify({ generation, cookies: [] }));
      await assert.rejects(runSessionHolder(seed), /synthetic launch failure/);
      assert.equal(launched, true);
      await assert.rejects(access(seed));
    });
  } finally {
    for (const [name, original] of handlers) {
      for (const handler of process.listeners(name)) if (!original.has(handler)) process.removeListener(name, handler);
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume verification failure closes Chrome before releasing lifecycle ownership", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-resume-"));
  const session = createPlaywrightSession({ profileDir: directory });
  let closes = 0;
  const page = { on() {}, goto: async () => undefined };
  const context = { pages: () => [page], on() {}, close: async () => {
    await access(join(directory, HOLDER_LIFECYCLE_LOCK, "owner"));
    closes++;
  } };
  t.mock.method(chromium, "launchPersistentContext", async () => {
    // This is the actual resume launch callsite, not merely the lock primitive.
    await access(join(directory, HOLDER_LIFECYCLE_LOCK, "owner"));
    return context as never;
  });
  Reflect.set(session, "waitForSessionSettled", async () => undefined);
  Reflect.set(session, "readSnapshot", async () => { throw new Error("synthetic verification failure"); });
  try {
    await assert.rejects(Reflect.get(session, "withProfileLifecycle").call(session,
      () => Reflect.get(session, "launchHeadlessResumeAndVerify").call(session)), /synthetic verification failure/);
    assert.equal(closes, 1);
    await assert.rejects(access(join(directory, HOLDER_LIFECYCLE_LOCK)));
    assert.equal(Reflect.get(session, "context"), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("signal during a rejected holder launch never acknowledges Chrome shutdown", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-launch-reject-"));
  const handlers = new Map((["SIGTERM", "SIGINT"] as const).map((name) => [name, new Set(process.listeners(name))]));
  let entered!: () => void, rejectLaunch!: (error: Error) => void, exited!: (code: number | undefined) => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const exit = new Promise<number | undefined>((resolve) => { exited = resolve; });
  t.mock.method(process, "exit", ((code?: number) => { exited(code); }) as never);
  t.mock.method(chromium, "launchPersistentContext", () => {
    entered();
    return new Promise<never>((_resolve, reject) => { rejectLaunch = reject; });
  });
  try {
    await withHolderLifecycle(directory, async (generation) => {
      const seed = holderSeedPath(directory, generation);
      await writeFile(seed, JSON.stringify({ generation, cookies: [] }));
      const operation = runSessionHolder(seed).catch((error: unknown) => error);
      await started;
      const handler = process.listeners("SIGTERM").find((candidate) => !handlers.get("SIGTERM")!.has(candidate));
      assert.ok(handler);
      handler("SIGTERM"); // Invoke only the captured holder callback, never signal a process.
      rejectLaunch(new Error("synthetic launch rejected after spawn"));
      assert.match(String(await operation), /synthetic launch rejected/);
      assert.equal(await exit, 1);
      await assert.rejects(access(join(directory, `session-stopped-${generation}.json`)));
      assert.equal(JSON.parse(await readFile(holderRecordPath(directory), "utf8")).launchPending, true);
    });
  } finally {
    for (const [name, original] of handlers) {
      for (const handler of process.listeners(name)) if (!original.has(handler)) process.removeListener(name, handler);
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed owned Chrome close preserves the lifecycle claim and context for explicit recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-close-"));
  const session = createPlaywrightSession({ profileDir: directory });
  const context = { close: async () => { throw new Error("synthetic close failed"); } };
  Reflect.set(session, "context", context);
  Reflect.set(session, "ownsChrome", true);
  try {
    await assert.rejects(session.close(), /Could not confirm ADAM Chrome closure/);
    await access(join(directory, HOLDER_LIFECYCLE_LOCK, "owner"));
    await access(join(directory, HOLDER_LIFECYCLE_LOCK, "recovery-required"));
    assert.equal(Reflect.get(session, "context"), context);
    assert.equal(Reflect.get(session, "ownsChrome"), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed page creation cannot discard owned Chrome and fall through to a replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-page-"));
  const session = createPlaywrightSession({ profileDir: directory });
  let replacement = false;
  const context = { pages: () => [], newPage: async () => { throw new Error("synthetic page failed"); },
    close: async () => { throw new Error("synthetic close failed"); } };
  Reflect.set(session, "context", context);
  Reflect.set(session, "ownsChrome", true);
  Reflect.set(session, "tryAttachCdp", async () => { replacement = true; return false; });
  Reflect.set(session, "resumeDeadHolderOrUnauthorized", async () => { replacement = true; });
  try {
    await assert.rejects(Reflect.get(session, "ensurePage").call(session, { allowResume: true }), /Could not confirm ADAM Chrome closure/);
    assert.equal(replacement, false);
    assert.equal(Reflect.get(session, "context"), context);
    assert.equal(Reflect.get(session, "ownsChrome"), true);
    await access(join(directory, HOLDER_LIFECYCLE_LOCK, "recovery-required"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("lifecycle exclusion works across processes without holding the publication lock", { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "adam-owner-process-"));
  const moduleUrl = new URL("./holder-lock.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import {withHolderLifecycle} from ${JSON.stringify(moduleUrl)};
    await withHolderLifecycle(${JSON.stringify(directory)}, async () => {
      const release = new Promise(resolve => process.once('message', resolve));
      process.send('locked'); await release;
    }); process.disconnect();
  `], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  try {
    await once(child, "message");
    await withHolderMutation(directory, async () => { /* A holder can publish while its parent waits. */ });
    const controller = new AbortController();
    let entered = false;
    const competing = withHolderLifecycle(directory, async () => { entered = true; }, controller.signal);
    controller.abort();
    await assert.rejects(competing, /cancelled/);
    assert.equal(entered, false);
    const exited = once(child, "exit");
    child.send("release");
    assert.deepEqual(await exited, [0, null]);
    await withHolderLifecycle(directory, async () => { entered = true; });
    assert.equal(entered, true);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
