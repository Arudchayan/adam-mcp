import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import { GLOSSARY_DEFINITION_CAP, parseGlossaryTerms, readGlossary } from "./glo.ts";
import { OBJECT_READERS, type ReaderContext } from "./index.ts";

/**
 * ADR 0062 / #165: glossary reader against the ILIAS 10.12 lab (tools/ilias-lab, glossary
 * ref 96 seeded by seed-wiki-glo.mjs; student capture by capture-glo-fixtures.mjs). The lab
 * serves http://localhost:8080; the markup is rebased onto ADAM's pinned origin.
 */
const ORIGIN = "https://adam.unibas.ch";
const fixtureHtml = (name: string) => {
  const fixture = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", ORIGIN);
};
// ILIAS lists the terms alphabetically.
const GLOSSARY_TERMS = ["Lab Term Alpha", "Lab Term Beta", "Lab Term Delta", "Lab Term Epsilon", "Lab Term Gamma", "Lab Term Zeta"];

/** A minimal reader context: the reader under test must not open any other page here. */
const context = (html: string, subPage?: string): ReaderContext => ({
  refId: "96",
  type: "glo",
  page: { url: `${ORIGIN}/go/glo/96`, html, text: textOf(html) },
  ...(subPage ? { subPage } : {}),
  open: async () => { throw new Error("glossary reader must not open pages"); },
  route: () => undefined,
  routes: () => [],
});

describe("ADR 0062: glossary reader (lab-verified)", () => {
  it("reads the seeded terms and their full definitions from the student's glossary page", async () => {
    const result = await readGlossary(context(fixtureHtml("glo-terms-student")));
    assert.ok(result);
    const detail = result.detail as { kind: string; evidence: string; terms: Array<{ term: string; definition: string }>; termCount: number; truncated?: boolean };
    assert.equal(detail.kind, "glossary");
    assert.equal(detail.evidence, "lab-verified");
    assert.equal(detail.termCount, 6);
    assert.equal(detail.truncated, undefined);
    assert.deepEqual(detail.terms.map((t) => t.term), GLOSSARY_TERMS);
    for (const entry of detail.terms) {
      assert.match(entry.definition, /^Lab: a synthetic definition of the [a-z]+ term, used for reader tests\.$/);
    }
    assert.equal(detail.terms[0]!.definition, "Lab: a synthetic definition of the alpha term, used for reader tests.");
    assert.equal(result.text, undefined);
  });

  it("returns undefined for pages that are not a glossary presentation", async () => {
    assert.equal(await readGlossary(context(fixtureHtml("course-student"))), undefined);
    assert.equal(await readGlossary(context("<main><h1>Glossary</h1><p>Lab: no table here.</p></main>")), undefined);
    assert.equal(parseGlossaryTerms("<div class=\"il-table-presentation-row row collapsed\"><div>no headline</div></div>"), undefined);
  });

  it("does not recognise a subPage: a glossary has no per-term route", async () => {
    assert.equal(await readGlossary(context(fixtureHtml("glo-terms-student"), "Lab Term Alpha")), undefined);
  });

  it("caps each definition and marks a glossary longer than the cap as truncated", () => {
    const row = (n: number, text: string) => `<div class="il-table-presentation-row row collapsed" id="r${n}"><div class="il-table-presentation-row-header-headline-wrap"><h4 class="il-table-presentation-row-header-headline">Lab Term ${n}</h4></div><div class="il-table-presentation-desclist col-lg col-sm-12"><p class="ilc_Paragraph">${text}</p></div></div>`;
    const long = "x".repeat(GLOSSARY_DEFINITION_CAP + 500);
    const parsed = parseGlossaryTerms(row(1, long));
    assert.ok(parsed);
    assert.equal(parsed.terms[0]!.definition.length, GLOSSARY_DEFINITION_CAP);
    const many = Array.from({ length: 205 }, (_, i) => row(i, "Lab definition.")).join("");
    const bulk = parseGlossaryTerms(many);
    assert.ok(bulk);
    assert.equal(bulk.terms.length, 200);
    assert.equal(bulk.termCount, 205);
    assert.equal(bulk.truncated, true);
  });

  it("marks a table whose footer shows more terms than were rendered as truncated", () => {
    const html = `${fixtureHtml("glo-terms-student")}<div class="ilTableFootLight">(1 - 6 of 9)</div>`;
    const parsed = parseGlossaryTerms(html);
    assert.ok(parsed);
    assert.equal(parsed.termCount, 9);
    assert.equal(parsed.truncated, true);
  });
});

describe("ADR 0062: glossary readPage end to end", () => {
  const html = fixtureHtml("glo-terms-student");
  const url = `${ORIGIN}/go/glo/96`;
  const provider = () => createBrowserProvider({
    session: createMemorySession({ [url]: snapshotFromHtml(url, "Lab glo", html, textOf(html)) }),
    clock: () => Date.parse("2026-11-17T10:00:00Z"),
  });

  it("attaches the glossary detail to readPage and rejects a subPage", async () => {
    assert.equal(OBJECT_READERS.glo, readGlossary);
    const page = await provider().readPage("96", { type: "glo" });
    assert.equal(page.detailStatus, "read");
    assert.equal((page.detail as unknown as { termCount: number }).termCount, 6);
    assert.match(page.text, /Lab Term Alpha/);
    await assert.rejects(
      provider().readPage("96", { type: "glo", subPage: "Lab Term Alpha" }),
      (error: unknown) => error instanceof AdamError && error.code === "stale_id",
    );
  });
});
