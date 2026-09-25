import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canResumeDeadHolder, resumeDeadHolderSession } from "./session-resume.ts";
import type { HolderRecord } from "./session-holder.ts";

function holderRecord(): HolderRecord {
  return {
    version: 2,
    pid: 4242,
    generation: "test",
    pidStartTime: "1",
    exe: "/tmp/holder",
    startedAt: "2026-09-25T00:00:00.000Z",
    verifiedAt: "2026-09-25T00:00:00.000Z",
    origin: "https://adam.unibas.ch",
  };
}

describe("canResumeDeadHolder", () => {
  it("resumes only when the holder is down and CDP is not attached", () => {
    assert.equal(canResumeDeadHolder({ holderRunning: false, attached: false }), true);
    assert.equal(canResumeDeadHolder({ holderRunning: true, attached: false }), false);
    assert.equal(canResumeDeadHolder({ holderRunning: false, attached: true }), false);
    assert.equal(canResumeDeadHolder({ holderRunning: true, attached: true }), false);
  });
});

describe("resumeDeadHolderSession", () => {
  it("skips when a holder is already running", async () => {
    let launched = 0;
    const outcome = await resumeDeadHolderSession({
      holderRunning: true,
      profileDir: "/tmp/adam-profile",
      origin: "https://adam.unibas.ch",
      launchHeadlessAndVerify: async () => {
        launched += 1;
        throw new Error("must not launch");
      },
      startHolder: async () => {
        throw new Error("must not start a holder");
      },
    });
    assert.equal(outcome, "skipped");
    assert.equal(launched, 0);
  });

  it("hands off cookies to a new holder when the profile is still signed in", async () => {
    let closed = 0;
    let started = 0;
    const outcome = await resumeDeadHolderSession({
      holderRunning: false,
      profileDir: "/tmp/adam-profile",
      origin: "https://adam.unibas.ch",
      launchHeadlessAndVerify: async () => ({
        loggedIn: true,
        exportSeed: async () => ({
          cookies: [
            {
              name: "PHPSESSID",
              value: "session",
              domain: "adam.unibas.ch",
              path: "/",
              expires: -1,
              httpOnly: true,
              secure: true,
              sameSite: "Lax",
            },
          ],
        }),
        close: async () => {
          closed += 1;
        },
      }),
      startHolder: async (options) => {
        started += 1;
        assert.equal(options.profileDir, "/tmp/adam-profile");
        assert.equal(options.seed.cookies.length, 1);
        assert.equal(options.seed.cookies[0]?.name, "PHPSESSID");
        assert.equal(closed, 1);
        return holderRecord();
      },
    });
    assert.equal(outcome, "signed-in");
    assert.equal(started, 1);
    assert.equal(closed, 1);
  });

  it("closes the temporary Chrome and does not start a holder on a login page", async () => {
    let closed = 0;
    let started = 0;
    const outcome = await resumeDeadHolderSession({
      holderRunning: false,
      profileDir: "/tmp/adam-profile",
      origin: "https://adam.unibas.ch",
      launchHeadlessAndVerify: async () => ({
        loggedIn: false,
        exportSeed: async () => {
          throw new Error("must not export cookies from a login page");
        },
        close: async () => {
          closed += 1;
        },
      }),
      startHolder: async () => {
        started += 1;
        return holderRecord();
      },
    });
    assert.equal(outcome, "login-required");
    assert.equal(closed, 1);
    assert.equal(started, 0);
  });

  it("does not spawn a second holder when Chrome is already attached", async () => {
    let started = 0;
    const outcome = await resumeDeadHolderSession({
      holderRunning: false,
      profileDir: "/tmp/adam-profile",
      origin: "https://adam.unibas.ch",
      launchHeadlessAndVerify: async () => ({
        alreadyAttached: true,
        loggedIn: true,
        exportSeed: async () => undefined,
        close: async () => undefined,
      }),
      startHolder: async () => {
        started += 1;
        return holderRecord();
      },
    });
    assert.equal(outcome, "already-attached");
    assert.equal(started, 0);
  });
});
