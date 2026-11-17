import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError, type AdamObjectType } from "adam-core";
import { advertisedRoute, advertisedRoutes } from "../advertised-route.ts";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { MAX_READER_PAGES, OBJECT_READERS, type ObjectReader } from "./index.ts";

// ADR 0062 contract: synthetic markup only.
const ORIGIN = "https://adam.unibas.ch";
const link = (href: string) => `<a href="${href}">x</a>`;
const rule = { cmdClass: /^ilwikipagegui$/i, keys: { page: /^[A-Za-z0-9_%+.-]{1,80}$/ } };

describe("ADR 0062: advertised routes", () => {
  it("accepts only same-ref, pinned-origin, allowlisted read routes", () => {
    const ok = "/ilias.php?baseClass=ilwikihandlergui&cmdClass=ilwikipagegui&cmd=preview&ref_id=5&page=Start";
    assert.equal(advertisedRoute(link(ok), "5", rule), `${ORIGIN}${ok}`);
    assert.equal(advertisedRoute(link(`https://evil.example${ok}`), "5", rule), undefined);
    assert.equal(advertisedRoute(link(ok.replace("ref_id=5", "ref_id=6")), "5", rule), undefined);
    assert.equal(advertisedRoute(link(`${ok}&rtoken=abc`), "5", rule), undefined);
    assert.equal(advertisedRoute(link(`${ok}&other=1`), "5", rule), undefined);
    assert.equal(advertisedRoute(link(ok.replace("cmd=preview", "cmd=deletePage")), "5", rule), undefined);
    assert.equal(advertisedRoute(link(ok.replace("page=Start", "page=../x")), "5", rule), undefined);
    assert.equal(advertisedRoute(`<button data-action="${ok.replace(/&/g, "&amp;")}">x</button>`, "5", rule), `${ORIGIN}${ok}`);
    assert.deepEqual(advertisedRoutes(link(ok) + link(ok) + link(ok.replace("Start", "Other")), "5", rule).length, 2);
  });
});

describe("ADR 0062: readPage runs the type's reader", () => {
  const wikiUrl = `${ORIGIN}/go/wiki/5`;
  const subUrl = `${ORIGIN}/ilias.php?baseClass=ilwikihandlergui&cmdClass=ilwikipagegui&cmd=preview&ref_id=5&page=Other`;
  const pages = {
    [wikiUrl]: snapshotFromHtml(wikiUrl, "Wiki", `<main><h1>Wiki</h1><p>Start text</p>${link(subUrl)}</main>`, "Wiki Start text"),
    [subUrl]: snapshotFromHtml(subUrl, "Other", "<main><h1>Other</h1><p>Other text</p></main>", "Other text"),
  };
  const provider = () => createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });
  const withReader = async (reader: ObjectReader | undefined, run: () => Promise<void>) => {
    const type: AdamObjectType = "wiki";
    const previous = OBJECT_READERS[type];
    if (reader) OBJECT_READERS[type] = reader; else delete OBJECT_READERS[type];
    try { await run(); } finally { if (previous) OBJECT_READERS[type] = previous; else delete OBJECT_READERS[type]; }
  };

  it("attaches detail, and reads a sub-page through an advertised route", async () => {
    await withReader(async (ctx) => {
      const pagesListed = ctx.routes(ctx.page.html, rule).map((url) => new URL(url).searchParams.get("page"));
      if (ctx.subPage) {
        const target = ctx.routes(ctx.page.html, rule).find((url) => new URL(url).searchParams.get("page") === ctx.subPage);
        if (!target) return undefined;
        const page = await ctx.open(target);
        return { detail: { kind: "wiki", evidence: "lab-verified", pages: pagesListed }, text: page.text };
      }
      return { detail: { kind: "wiki", evidence: "lab-verified", pages: pagesListed } };
    }, async () => {
      const page = await provider().readPage("5", { type: "wiki" });
      assert.equal(page.detailStatus, "read");
      assert.deepEqual(page.detail, { kind: "wiki", evidence: "lab-verified", pages: ["Other"] });
      const sub = await provider().readPage("5", { type: "wiki", subPage: "Other" });
      assert.equal(sub.subPage, "Other");
      assert.match(sub.text, /Other text/);
      await assert.rejects(provider().readPage("5", { type: "wiki", subPage: "Missing" }), (error: unknown) => error instanceof AdamError && error.code === "stale_id");
    });
  });

  it("keeps the text when the reader does not recognise the page or throws", async () => {
    await withReader(async () => undefined, async () => {
      const page = await provider().readPage("5", { type: "wiki" });
      assert.equal(page.detailStatus, "unrecognised");
      assert.match(page.text, /Start text/);
    });
    await withReader(async () => { throw new Error("parser bug"); }, async () => {
      const page = await provider().readPage("5", { type: "wiki" });
      assert.equal(page.detailStatus, "unrecognised");
    });
  });

  it("bounds the pages a reader may open", async () => {
    await withReader(async (ctx) => {
      for (let i = 0; i <= MAX_READER_PAGES; i++) await ctx.open(subUrl);
      return { detail: { kind: "wiki", evidence: "lab-verified" } };
    }, async () => {
      const page = await provider().readPage("5", { type: "wiki" });
      assert.equal(page.detailStatus, "unrecognised");
    });
  });

  it("rejects subPage for types without a reader", async () => {
    await withReader(undefined, async () => {
      await assert.rejects(provider().readPage("5", { type: "wiki", subPage: "Other" }), (error: unknown) => error instanceof AdamError && error.code === "unsupported_type");
    });
  });
});
