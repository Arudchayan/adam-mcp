import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { chromium } from "playwright-core";
import { retireNavigationTab } from "./playwright-session.ts";

type FakePage = {
  closed: boolean;
  calls: string[];
  isClosed(): boolean;
  close(): Promise<void>;
  goto(url: string): Promise<null>;
  context(): FakeContext;
};
type FakeContext = { open: FakePage[]; failNewPage: boolean; pages(): FakePage[]; newPage(): Promise<FakePage> };

function fakeContext(failNewPage = false): FakeContext {
  const context: FakeContext = {
    open: [],
    failNewPage,
    pages: () => context.open.filter((page) => !page.closed),
    newPage: async () => {
      if (context.failNewPage) throw new Error("Target page, context or browser has been closed");
      return fakePage(context);
    },
  };
  return context;
}

function fakePage(context: FakeContext): FakePage {
  const page: FakePage = {
    closed: false,
    calls: [],
    isClosed: () => page.closed,
    close: async () => { page.calls.push("close"); page.closed = true; },
    goto: async (url) => { page.calls.push("goto " + url); return null; },
    context: () => context,
  };
  context.open.push(page);
  return page;
}

describe("ADR 0045: cancelled navigation keeps a Chrome tab open", () => {
  it("opens a blank replacement before closing the holder's last tab", async () => {
    const context = fakeContext();
    const page = fakePage(context);
    await retireNavigationTab(page);
    assert.deepEqual(page.calls, ["close"]);
    assert.equal(context.pages().length, 1, "a replacement tab must keep the browser session alive");
  });

  it("closes directly when another tab is already open", async () => {
    const context = fakeContext();
    const page = fakePage(context);
    fakePage(context);
    await retireNavigationTab(page);
    assert.deepEqual(page.calls, ["close"]);
    assert.equal(context.open.length, 2, "no extra tab is opened");
    assert.equal(context.pages().length, 1);
  });

  it("stops the navigation in place when no replacement tab can be opened", async () => {
    const context = fakeContext(true);
    const page = fakePage(context);
    await retireNavigationTab(page);
    assert.deepEqual(page.calls, ["goto about:blank"], "the last tab is never closed");
    assert.equal(context.pages().length, 1);
  });

  it("does nothing for an already closed tab", async () => {
    const context = fakeContext();
    const page = fakePage(context);
    page.closed = true;
    await retireNavigationTab(page);
    assert.deepEqual(page.calls, []);
    assert.equal(context.open.length, 1);
  });
});

// Opt-in disposable Chrome only: loopback server and a temporary profile; no ADAM/profile access.
it("real Chrome: session cookies survive a cancelled navigation on the holder's only tab", { skip: process.env.ADAM_TEST_CHROME !== "1" }, async () => {
  const server = createServer((request, response) => {
    const reply = () => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<p>" + (request.headers.cookie ?? "NO-COOKIE") + "</p>");
    };
    if (request.url === "/slow") setTimeout(reply, 3_000);
    else reply();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const profile = await mkdtemp(join(tmpdir(), "adam-tab-retire-"));
  const holder = await chromium.launchPersistentContext(profile, {
    channel: "chrome", headless: true, args: ["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"],
  });
  try {
    await holder.addCookies([{ name: "SESSION", value: "synthetic", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }]);
    const page = holder.pages()[0] ?? await holder.newPage();
    const navigation = page.goto(origin + "/slow").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await retireNavigationTab(page);
    await navigation;
    const next = holder.pages().find((open) => !open.isClosed()) ?? await holder.newPage();
    await next.goto(origin + "/");
    assert.equal(await next.innerText("p"), "SESSION=synthetic");
  } finally {
    await holder.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
