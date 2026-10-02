import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runStatusCli } from "./status-cli.ts";
import type { AdamBrowserSession } from "./session-types.ts";

function fakeSession(): AdamBrowserSession {
  return {
    async status() {
      return {
        loggedIn: true,
        origin: "https://adam.unibas.ch",
        currentUrl: "https://adam.unibas.ch/",
        title: "Schreibtisch",
        reason: "signed-in" as const,
        checkedAt: "2026-10-02T00:00:00.000Z",
      };
    },
    async open() {
      throw new Error("not used");
    },
    async loginInteractively() {
      throw new Error("not used");
    },
    async fetchAuthorized() {
      throw new Error("not used");
    },
    async close() {
      return;
    },
  };
}

async function captureReport(argv: string[]): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "adam-status-"));
  const previous = process.env.ADAM_BROWSER_PROFILE_DIR;
  process.env.ADAM_BROWSER_PROFILE_DIR = dir;
  const logs: string[] = [];
  const originalLog = console.log;
  const originalExit = process.exitCode;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };
  try {
    await runStatusCli(fakeSession, argv);
    assert.equal(logs.length, 1);
    return JSON.parse(logs[0]!) as Record<string, unknown>;
  } finally {
    console.log = originalLog;
    process.exitCode = originalExit;
    if (previous === undefined) {
      delete process.env.ADAM_BROWSER_PROFILE_DIR;
    } else {
      process.env.ADAM_BROWSER_PROFILE_DIR = previous;
    }
  }
}

describe("status-cli", () => {
  it("default mirrors tool keys without holder/profileDir (ADR 0018)", async () => {
    const report = await captureReport([]);
    assert.equal(report.loggedIn, true);
    assert.ok("holderPid" in report, "holderPid is a tool key and stays in default");
    assert.equal("holder" in report, false, "holder detail stays behind --verbose");
    assert.equal("profileDir" in report, false, "profileDir stays behind --verbose");
  });

  it("verbose adds holder/profileDir", async () => {
    const report = await captureReport(["--verbose"]);
    assert.ok("holderPid" in report);
    assert.ok("holder" in report, "verbose includes holder detail");
    assert.ok("profileDir" in report, "verbose includes profileDir");
  });
});
