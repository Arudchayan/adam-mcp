import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { AdamError } from "adam-core";
import { waitForAdamLogin } from "./login-wait.ts";
import { runLoginCli } from "./login-cli.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import { disableSession, enableSession, sessionDisabled } from "./session-disabled.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import { runLogoutCli } from "./logout-cli.ts";
import type { PageSnapshot } from "./session-types.ts";

it("returns immediately when the user closes the sign-in window", async () => {
  await assert.rejects(() => waitForAdamLogin({ closed: () => true, onAdam: () => false, snapshot: async () => { throw new Error("must not capture"); }, timeoutMs: 600_000 }),
    (error: unknown) => error instanceof AdamError && error.code === "cancelled");
});
it("does not capture SWITCH forms and waits only until its deadline", async () => {
  let clock = 0, captures = 0;
  await assert.rejects(() => waitForAdamLogin({ closed: () => false, onAdam: () => false, snapshot: async () => { captures++; throw new Error("credential form"); }, timeoutMs: 900, clock: () => clock, sleep: async (ms) => { clock += ms; } }), /timed out/);
  assert.equal(captures, 0); assert.equal(clock, 900);
});
it("returns the verified ADAM dashboard and honors cancellation and logout", async () => {
  const snapshot = snapshotFromHtml("https://adam.unibas.ch", "Dashboard", "", "Dashboard Abmelden");
  assert.equal(await waitForAdamLogin({ closed: () => false, onAdam: () => true, snapshot: async () => snapshot, timeoutMs: 1000 }), snapshot);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => waitForAdamLogin({ closed: () => false, onAdam: () => false, snapshot: async () => snapshot, timeoutMs: 1000, signal: controller.signal }), /cancelled/i);
  await assert.rejects(() => waitForAdamLogin({ closed: () => false, onAdam: () => false, snapshot: async () => snapshot, timeoutMs: 1000, loggedOut: async () => true }), /Logout was requested/);
});
it("login CLI reuses a signed-in session without interactive Chrome and always cleans up", async () => {
  const session = createMemorySession({ home: snapshotFromHtml("https://adam.unibas.ch", "Dashboard", "", "Dashboard Abmelden") });
  let interactive = 0, closed = 0;
  session.loginInteractively = async () => { interactive++; throw new Error("must not launch"); };
  session.close = async () => { closed++; };
  await runLoginCli(() => session, []);
  assert.equal(interactive, 0); assert.equal(closed, 1);
});
it("login CLI cleans up a failed sign-in and validates timeout before creating a session", async () => {
  const session = createMemorySession({});
  let closed = 0;
  session.loginInteractively = async () => { throw new AdamError("cancelled", "Window closed.", false); };
  session.close = async () => { closed++; };
  await assert.rejects(() => runLoginCli(() => session, ["--force"]), /Window closed/);
  assert.equal(closed, 1);
  await assert.rejects(() => runLoginCli(() => { throw new Error("must not create session"); }, ["--timeout-ms", "wrong"]), /--timeout-ms/);
});
it("explicit logout prevents status or reads from resuming Chrome until login", async () => {
  const profileDir = await mkdtemp(join(tmpdir(), "adam-logout-"));
  try {
    await disableSession(profileDir);
    assert.equal(await sessionDisabled(profileDir), true);
    const session = createPlaywrightSession({ profileDir });
    assert.equal((await session.status()).loggedIn, false);
    await assert.rejects(() => session.open("https://adam.unibas.ch"), /explicitly logged out/);
    await session.close();
    await enableSession(profileDir);
    assert.equal(await sessionDisabled(profileDir), false);
  } finally { await rm(profileDir, { recursive: true, force: true }); }
});

it("snapshot capture never reads SWITCH credential forms, including the initial redirect", async () => {
  const session = createPlaywrightSession();
  const reader = session as unknown as { readSnapshot(page: unknown): Promise<PageSnapshot> };
  const page = { url: () => "https://login.eduid.ch/", content: () => { throw new Error("must not read credential HTML"); } };
  const snapshot = await reader.readSnapshot(page);
  assert.equal(snapshot.html, "");
  assert.deepEqual(snapshot.links, []);
  assert.equal(snapshot.text, "Bei ADAM anmelden");
});

it("concurrent login requests reuse the same operation and a valid session", async () => {
  const session = createPlaywrightSession();
  let checks = 0;
  session.status = async () => { checks++; return { loggedIn: true, reason: "signed-in" }; };
  const first = session.loginInteractively();
  assert.equal(session.loginInteractively(), first);
  assert.equal((await first).loggedIn, true);
  assert.equal(checks, 1);
});

it("purge refuses the current workspace before touching files", async () => {
  const previous = process.env.ADAM_BROWSER_PROFILE_DIR;
  process.env.ADAM_BROWSER_PROFILE_DIR = process.cwd();
  try { await assert.rejects(() => runLogoutCli(["--purge"]), /Refusing to purge/); }
  finally {
    if (previous === undefined) delete process.env.ADAM_BROWSER_PROFILE_DIR;
    else process.env.ADAM_BROWSER_PROFILE_DIR = previous;
  }
});

it("status does not attach to or navigate another process's unfinished sign-in window", async () => {
  const profileDir = await mkdtemp(join(tmpdir(), "adam-login-window-"));
  const originalFetch = globalThis.fetch;
  try {
    await writeFile(join(profileDir, "DevToolsActivePort"), "9222\n/devtools/browser/synthetic\n");
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    const session = createPlaywrightSession({ profileDir });
    const status = await session.status();
    assert.equal(status.loggedIn, false);
    assert.equal(status.reason, "unknown");
    assert.match(status.message ?? "", /sign-in window is already open/);
    await session.close();
  } finally {
    globalThis.fetch = originalFetch;
    await rm(profileDir, { recursive: true, force: true });
  }
});
