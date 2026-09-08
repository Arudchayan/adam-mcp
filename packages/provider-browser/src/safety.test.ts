import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostnameAllowed, urlAllowed } from "./allowlist.ts";
import { parseDevToolsActivePort } from "./cdp.ts";
import { attachDownloadGuard, CHROME_LAUNCH_POLICY, chromeLaunchArgs } from "./download-guard.ts";
import { MAX_PAGE_TEXT, capText } from "./extract.ts";
import { SerialQueue } from "./serial-queue.ts";

describe("allowlist", () => {
  it("pins ADAM to adam.unibas.ch and rejects lookalike hosts", () => {
    assert.equal(hostnameAllowed("adam.unibas.ch"), true);
    assert.equal(hostnameAllowed("evil.adam.unibas.ch"), false);
    assert.equal(urlAllowed("https://login.eduid.ch/"), true);
    assert.equal(urlAllowed("https://wayf.switch.ch/"), true);
    assert.equal(urlAllowed("http://adam.unibas.ch/"), false);
  });
});

describe("size caps", () => {
  it("truncates page text to MAX_PAGE_TEXT", () => {
    const oversized = "x".repeat(MAX_PAGE_TEXT + 50);
    assert.equal(capText(oversized).length, MAX_PAGE_TEXT);
  });
});

describe("Chrome download policy", () => {
  it("disables downloads and uses an ephemeral debug port", () => {
    assert.equal(CHROME_LAUNCH_POLICY.acceptDownloads, false);
    assert.equal(CHROME_LAUNCH_POLICY.remoteDebuggingPort, 0);
    assert.equal(chromeLaunchArgs().includes("--remote-debugging-port=0"), true);
  });

  it("cancels downloads on the page emitter", async () => {
    const cancelled: string[] = [];
    const listeners: Array<(download: { cancel(): Promise<void> }) => void> = [];
    const page = {
      on(event: "download", listener: (download: { cancel(): Promise<void> }) => void) {
        if (event === "download") {
          listeners.push(listener);
        }
      },
    };
    attachDownloadGuard(page);
    await new Promise<void>((resolve) => {
      listeners[0]?.({
        async cancel() {
          cancelled.push("yes");
          resolve();
        },
      });
    });
    assert.deepEqual(cancelled, ["yes"]);
  });
});

describe("CDP endpoint parsing", () => {
  it("reads only the first line of DevToolsActivePort", () => {
    assert.equal(parseDevToolsActivePort("41221\n/devtools/browser/abc"), 41221);
    assert.equal(parseDevToolsActivePort("nope"), undefined);
    assert.equal(parseDevToolsActivePort("0"), undefined);
  });
});

describe("serial queue", () => {
  it("runs work one at a time", async () => {
    const queue = new SerialQueue();
    const order: number[] = [];
    const first = queue.enqueue(async () => {
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(2);
    });
    const second = queue.enqueue(async () => {
      order.push(3);
    });
    await Promise.all([first, second]);
    assert.deepEqual(order, [1, 2, 3]);
  });
});
