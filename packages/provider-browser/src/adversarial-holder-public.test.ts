import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devToolsActivePortPath, holderRecordPath, holderSeedPath, holderStatus, stopSessionHolder } from "./session-holder.ts";

test("responding synthetic CDP protects a stale record and seed from cleanup", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adam-holder-public-"));
  const kill = t.mock.method(process, "kill", () => { throw Object.assign(new Error("mock dead process"), { code: "ESRCH" }); });
  const fetch = t.mock.method(globalThis, "fetch", async () => ({ ok: true }) as Response);
  const record = JSON.stringify({ version: 2, pid: 7654321, generation: "stale", pidStartTime: "old", exe: "mock", startedAt: "mock", verifiedAt: "mock", origin: "https://adam.unibas.ch" });
  try {
    await writeFile(holderRecordPath(dir), record);
    await writeFile(holderSeedPath(dir), "synthetic");
    await writeFile(devToolsActivePortPath(dir), "41234\n/devtools/browser/synthetic");
    assert.equal((await holderStatus(dir)).running, false);
    await assert.rejects(stopSessionHolder(dir), /PID bind failed/);
    assert.equal(await readFile(holderRecordPath(dir), "utf8"), record);
    assert.equal(await readFile(holderSeedPath(dir), "utf8"), "synthetic");
    assert.ok(kill.mock.calls.every((call) => call.arguments[1] === 0));
    assert.ok(fetch.mock.calls.every((call) => call.arguments[0] === "http://127.0.0.1:41234/json/version"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
