import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { advertisedRoute, advertisedRoutes } from "../advertised-route.ts";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import type { ReaderContext, ReaderPage } from "./index.ts";
import { readHtmlModule } from "./htlm.ts";

// ADR 0062 / ADR 0057 lab evidence: ILIAS 10.12 lab (tools/ilias-lab), lab seed data only.
const ORIGIN = "https://adam.unibas.ch";
const fixture = (name: string) => {
  const parsed = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { url: string; html: string };
  return { url: parsed.url.replaceAll("http://localhost:8080", ORIGIN), html: parsed.html.replaceAll("http://localhost:8080", ORIGIN) };
};
const presentation = `${ORIGIN}/ilias.php?baseClass=ilHTLMPresentationGUI&ref_id=94`;
const readerPage = (url: string, html: string): ReaderPage => ({ url, html, text: textOf(html) });

const contextFor = (page: ReaderPage, subPage?: string, open?: ReaderContext["open"]): ReaderContext => ({
  refId: "94",
  type: "htlm",
  page,
  ...(subPage !== undefined ? { subPage } : {}),
  open: open ?? (async () => { throw new Error("unexpected open"); }),
  route: (html, rule) => advertisedRoute(html, "94", rule),
  routes: (html, rule) => advertisedRoutes(html, "94", rule),
});

describe("ADR 0062: HTML module (htlm) reader, lab-verified", () => {
  it("reports the start file and the start sub-page on the Info screen", async () => {
    const info = fixture("htlm-info-student");
    const result = await readHtmlModule(contextFor(readerPage(info.url, info.html)));
    assert.deepEqual(result, { detail: { kind: "html-module", evidence: "lab-verified", startFileSet: true, startSubPage: "start" } });
  });

  it("reports no start file when the Info screen says so, and offers no start sub-page", async () => {
    const info = fixture("htlm-info-student");
    const unset = { url: info.url, html: info.html.replace("</body>", "<p>No Start File.</p></body>") };
    const page = readerPage(unset.url, unset.html);
    assert.deepEqual(await readHtmlModule(contextFor(page)), { detail: { kind: "html-module", evidence: "lab-verified", startFileSet: false } });
    assert.equal(await readHtmlModule(contextFor(page, "start")), undefined);
  });

  it("opens only the advertised presentation route to read the start file", async () => {
    const info = fixture("htlm-info-student");
    const opened: string[] = [];
    const start = fixture("htlm-start-student");
    const open: ReaderContext["open"] = async (url) => {
      opened.push(url);
      return readerPage(start.url, start.html);
    };
    const result = await readHtmlModule(contextFor(readerPage(info.url, info.html), "start", open));
    assert.deepEqual(opened, [presentation]);
    assert.match(result?.text ?? "", /Synthetic lab text for the HTML module start page/);
  });

  it("returns undefined for unrelated pages and for sub-pages other than the start file", async () => {
    const copa = fixture("copa-view-student");
    assert.equal(await readHtmlModule(contextFor(readerPage(copa.url, copa.html))), undefined);
    const info = fixture("htlm-info-student");
    assert.equal(await readHtmlModule(contextFor(readerPage(info.url, info.html), "lab-second.html")), undefined);
  });
});

describe("ADR 0062: HTML module (htlm) end-to-end readPage", () => {
  const info = fixture("htlm-info-student");
  const start = fixture("htlm-start-student");
  const pages = {
    // The Info screen's own URL (ilInfoScreenGUI) does not name the type; the object is opened by its /go/ link.
    [`${ORIGIN}/go/htlm/94`]: snapshotFromHtml(`${ORIGIN}/go/htlm/94`, "Lab htlm", info.html, textOf(info.html)),
    [presentation]: snapshotFromHtml(start.url, "Lab HTML start", start.html, textOf(start.html)),
  };
  const provider = () => createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });

  it("attaches the html-module detail and reads the start file through subPage", async () => {
    const page = await provider().readPage("94", { type: "htlm" });
    assert.equal(page.detailStatus, "read");
    assert.deepEqual(page.detail, { kind: "html-module", evidence: "lab-verified", startFileSet: true, startSubPage: "start" });
    const sub = await provider().readPage("94", { type: "htlm", subPage: "start" });
    assert.equal(sub.subPage, "start");
    assert.match(sub.text, /Synthetic lab text for the HTML module start page/);
  });

  it("reports an unknown subPage as stale_id", async () => {
    await assert.rejects(provider().readPage("94", { type: "htlm", subPage: "lab-second.html" }), (error: unknown) => error instanceof AdamError && error.code === "stale_id");
  });
});
