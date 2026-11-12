import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { holderRecordPath, holderSeedPath, startSessionHolder } from "./session-holder.ts";
import { withHolderLifecycle } from "./holder-lock.ts";

test("synchronous handoff factory failure removes only its uniquely owned seed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "adam-private-handoff-"));
  t.mock.method(process, "kill", () => { throw new Error("unexpected process access"); });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network access"); });
  const foreign = JSON.stringify({ generation: "foreign", cookies: [] });
  const foreignRecord = JSON.stringify({ generation: "foreign", synthetic: true });
  try {
    await assert.rejects(startSessionHolder({ profileDir: directory, seed: { cookies: [], userAgent: "synthetic-only" }, spawnHolder: () => {
      writeFileSync(holderSeedPath(directory), foreign);
      writeFileSync(holderRecordPath(directory), foreignRecord);
      throw new Error("synthetic synchronous factory failure");
    } }), /synthetic synchronous factory failure/);
    assert.equal(await readFile(holderSeedPath(directory), "utf8"), foreign);
    assert.equal(await readFile(holderRecordPath(directory), "utf8"), foreignRecord);
    assert.deepEqual((await readdir(directory)).sort(), ["session-holder.json", "session-seed.json"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a failed handoff without foreign metadata leaves no credential seed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adam-private-handoff-"));
  try {
    await assert.rejects(startSessionHolder({ profileDir: directory, seed: { cookies: [] },
      spawnHolder: () => { throw new Error("synthetic synchronous factory failure"); } }), /synthetic synchronous factory failure/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("exclusive creation failure never removes a pre-existing generation path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adam-private-handoff-"));
  try {
    await withHolderLifecycle(directory, async (generation) => {
      const seedFile = holderSeedPath(directory, generation);
      writeFileSync(seedFile, "synthetic pre-existing handoff");
      await assert.rejects(startSessionHolder({ profileDir: directory, lifecycleGeneration: generation,
        seed: { cookies: [] }, spawnHolder: () => { throw new Error("must not spawn"); } }), /EEXIST/);
      assert.equal(await readFile(seedFile, "utf8"), "synthetic pre-existing handoff");
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
