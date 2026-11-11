import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { folderContentTab, rejectUnresolvedFolder } from "./folder-listing.ts";
import { snapshotFromHtml } from "./memory-session.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import type { PageSnapshot } from "./session-types.ts";

const url = "https://adam.unibas.ch/go/fold/100010";
const tab = "https://adam.unibas.ch/ilias.php?baseClass=ilRepositoryGUI&cmdClass=ilObjFolderGUI&cmd=render&ref_id=100010&cmdNode=1:2";
const blank: PageSnapshot = { ...snapshotFromHtml(url, "Synthetic folder", '<main><div id="il_center_col"></div></main>', "ILIAS Abmelden"), dom: { itemRows: 0, emptyCopy: false, contentBlank: true } };
const full: PageSnapshot = { ...snapshotFromHtml(url, "Synthetic folder", '<main><a href="/go/file/100011">Sheet.pdf</a><a href="/go/tst/100012">Test</a></main>', "Sheet.pdf Test"), dom: { itemRows: 2, emptyCopy: false } };
const empty: PageSnapshot = { ...blank, text: "This folder is empty", dom: { itemRows: 0, emptyCopy: true } };

function setup(snapshots: PageSnapshot[], tabs = [tab], failure?: number) {
  const session = createPlaywrightSession();
  const opens: string[] = [];
  const waits: number[] = [];
  let index = -1;
  const page = {
    async goto(target: string) { opens.push(target); index++; return failure && index > 0 ? { ok: () => false, status: () => failure } : null; },
    async waitForFunction(_script: string, _arg: unknown, options: { timeout: number }) { waits.push(options.timeout); },
    async evaluate() { return tabs; },
    locator: () => ({ filter: () => ({ first: () => ({ async click() {} }) }) }),
  };
  Reflect.set(session, "ensurePage", async () => page);
  Reflect.set(session, "rejectIfBlocked", async () => {});
  Reflect.set(session, "probeListing", async () => undefined);
  Reflect.set(session, "readSnapshot", async () => snapshots[Math.min(index, snapshots.length - 1)]!);
  return { session, opens, waits, provider: createBrowserProvider({ session }) };
}

it("recovers a folder through one advertised Content/Inhalt tab, inventories files and keeps tst denied", async () => {
  const { provider, opens, waits } = setup([blank, full]);
  const children = await provider.listChildren("100010", { type: "fold" });
  assert.equal(children.listingState, "ok");
  assert.deepEqual(children.items.map((item) => item.refId), ["100011"]);
  assert.deepEqual((await provider.listFiles("100010", { type: "fold" })).items.map((item) => item.refId), ["100011"]);
  assert.deepEqual(opens, [url, tab], "recovered typed listing is reusable, without another navigation");
  assert.deepEqual(waits, [12_000, 5_000]);
});

it("does not recover an already populated or explicitly empty folder", async () => {
  for (const snapshot of [full, empty]) {
    const { provider, opens } = setup([snapshot]);
    const result = await provider.listChildren("100010", { type: "fold" });
    assert.equal(result.listingState, snapshot === full ? "ok" : "empty");
    assert.deepEqual(opens, [url]);
  }
});

it("recovers a typed folder landing even when the caller omitted its type", async () => {
  const { provider, opens } = setup([blank, blank, full]);
  assert.equal((await provider.listChildren("100010")).listingState, "ok");
  assert.deepEqual(opens, [url.replace("/fold/", "/crs/"), url, tab]);
});

it("getCourse preserves a verified same-ref blank folder for unsupported_type without recovery", async () => {
  for (const type of [undefined, "fold"] as const) {
    const { provider, opens } = setup([blank]);
    await assert.rejects(() => provider.getCourse("100010", { type }),
      (error: unknown) => error instanceof AdamError && error.code === "unsupported_type" && /is fold, not a course/.test(error.message));
    assert.deepEqual(opens, [type === "fold" ? url : url.replace("/fold/", "/crs/")], "no content-tab recovery for a course operation");
  }
});

it("a shared course probe keeps getter type validation independent of untyped listing recovery", async () => {
  const { provider, opens } = setup([blank]);
  const results = await Promise.allSettled([provider.getCourse("100010"), provider.listChildren("100010")]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "rejected");
  if (results[0].status === "rejected") assert.equal(results[0].reason.code, "unsupported_type");
  if (results[1].status === "rejected") assert.equal(results[1].reason.code, "provider_unavailable");
  assert.deepEqual(opens, [url.replace("/fold/", "/crs/"), url, tab]);
});

it("conflicting operation expectations do not share an in-flight folder failure", async () => {
  const { provider, opens } = setup([blank]);
  const results = await Promise.allSettled([provider.listChildren("100010", { type: "fold" }), provider.getCourse("100010", { type: "fold" })]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "rejected");
  if (results[0].status === "rejected") assert.equal(results[0].reason.code, "provider_unavailable");
  if (results[1].status === "rejected") assert.equal(results[1].reason.code, "unsupported_type");
  assert.deepEqual(opens, [url, tab, url]);
});

it("a listing with unrelated empty-folder prose is unknown when its DOM has no empty message", () => {
  assert.throws(() => rejectUnresolvedFolder({ ...blank, text: "Documentation: this folder is empty is an example" }, "100010", false), /blank_content/);
});

it("cancellation during content-tab recovery closes only the active tab", async () => {
  const { session } = setup([blank]);
  let entered!: () => void;
  const recovering = new Promise<void>((done) => { entered = done; });
  let fail!: (error: Error) => void;
  const blocked = new Promise<null>((_resolve, reject) => { fail = reject; });
  let closed = 0, navigations = 0;
  const page = {
    async goto() { if (++navigations === 1) return null; entered(); return blocked; },
    async waitForFunction() {},
    async evaluate() { return [tab]; },
    async close() { closed++; fail(new Error("Target closed")); },
  };
  Reflect.set(session, "ensurePage", async () => { Reflect.set(session, "page", page); return page; });
  Reflect.set(session, "readSnapshot", async () => blank);
  const controller = new AbortController();
  const reading = session.open(url, { signal: controller.signal });
  await recovering;
  controller.abort();
  await assert.rejects(reading, (error: unknown) => error instanceof AdamError && error.code === "cancelled");
  assert.equal(closed, 1);
  assert.equal(navigations, 2);
});

it("a recovered empty folder is empty only with explicit empty evidence", async () => {
  const { provider, opens } = setup([blank, empty]);
  const result = await provider.listFiles("100010", { type: "fold" });
  assert.equal(result.listingState, "empty");
  assert.deepEqual(result.items, []);
  assert.equal(opens.length, 2);
});

it("persistent blank listings produce a specific nonretryable provider error, never a cached empty inventory", async () => {
  const { provider, opens } = setup([blank]);
  for (const list of [() => provider.listChildren("100010", { type: "fold" }), () => provider.listFiles("100010", { type: "fold" })]) {
    await assert.rejects(list, (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "provider_unavailable");
      assert.equal(error.retryable, false);
      assert.match(error.message, /blank_content; content_tab_recovery=attempted/);
      assert.match(error.message, /not an empty folder/);
      assert.match(error.message, /select Content\/Inhalt/);
      return true;
    });
  }
  assert.deepEqual(opens, [url, tab, url, tab]);
});

it("missing content tabs and row parsing failures provide distinct actionable diagnostics", async () => {
  const { session, opens } = setup([blank], []);
  await assert.rejects(() => session.open(url), /blank_content; content_tab_recovery=unavailable/);
  assert.deepEqual(opens, [url]);
  assert.throws(() => rejectUnresolvedFolder({ ...blank, dom: { itemRows: 2, emptyCopy: false } }, "100010", false), /unparsed_rows/);
  assert.throws(() => rejectUnresolvedFolder({ ...blank, dom: { itemRows: 0, emptyCopy: false } }, "100010", false), /no_listing_evidence/);
});

it("scrubbed historical blank-folder fixtures get diagnostics, not claims of a live root cause", () => {
  for (const name of ["folder-blank-exercises", "folder-blank-notes"]) {
    const fixture = JSON.parse(readFileSync(new URL(`../fixtures/live/${name}.json`, import.meta.url), "utf8"));
    const snapshot = { ...snapshotFromHtml(fixture.url, fixture.title, fixture.html, fixture.text), dom: fixture.dom };
    assert.throws(() => rejectUnresolvedFolder(snapshot, "100010", false), /blank_content/);
  }
});

it("tab recovery preserves HTTP permission/rate-limit errors", async () => {
  for (const [status, code] of [[403, "forbidden"], [429, "provider_unavailable"]] as const) {
    const { provider } = setup([blank], [tab], status);
    await assert.rejects(() => provider.listChildren("100010", { type: "fold" }), (error: unknown) => error instanceof AdamError && error.code === code && error.message.includes(String(status)));
  }
});

it("stale, denied-test, permission and login landings are not relabelled as blank-folder errors", async () => {
  for (const [snapshot, code] of [
    [{ ...blank, url: "https://adam.unibas.ch/go/fold/100099" }, "stale_id"],
    [{ ...blank, url: "https://adam.unibas.ch/go/tst/100010" }, "unsupported_type"],
    [{ ...blank, text: "Bei ADAM anmelden" }, "unauthorized"],
    [{ ...blank, text: "Permission denied" }, "forbidden"],
  ] as const) {
    const { provider, opens } = setup([snapshot]);
    await assert.rejects(() => provider.listChildren("100010", { type: "fold" }), (error: unknown) => error instanceof AdamError && error.code === code);
    assert.deepEqual(opens, [url]);
  }
});

it("only permits same-origin same-folder explicitly read-only tab URLs", () => {
  assert.equal(folderContentTab([tab], url, "100010"), tab);
  for (const unsafe of [
    tab.replace("adam.unibas.ch", "external.invalid"), tab.replace("https:", "http:"),
    tab.replace("100010", "100099"), tab.replace("render", "delete"),
    tab.replace("ilObjFolderGUI", "ilObjTestGUI"), tab.replace("ilRepositoryGUI", "ilObjTestGUI"),
    `${tab}&item_ref_id=100099`, `${tab}&cmd=delete`, `${tab}&CMD=view`, `${tab}&return=https://external.invalid`,
    `${tab}#action`, "javascript:alert(1)", url,
  ]) assert.equal(folderContentTab([unsafe], url, "100010"), undefined, unsafe);
});
