import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createBrowserProvider } from "../browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../memory-session.ts";
import { textOf } from "../ui-items.ts";
import { OBJECT_READERS, type ReaderContext } from "./index.ts";
import { readLearningSequence, type LearningSequenceDetail } from "./lso.ts";

/**
 * ADR 0062 (#165): the learning sequence learner view from the ILIAS 10.12 lab
 * (tools/ilias-lab), as a student. URLs are rebased onto ADAM's pinned origin.
 */
const ORIGIN = "https://adam.unibas.ch";
const lab = (name: string) => {
  const fixture = JSON.parse(readFileSync(new URL(`../../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", ORIGIN);
};
const ctx = (html: string) => ({ page: { url: `${ORIGIN}/go/lso/90`, html, text: textOf(html) } }) as unknown as ReaderContext;

describe("ADR 0062: learning sequence reader on the lab learner view", () => {
  it("lists the seeded steps in order with their status", async () => {
    const result = await readLearningSequence(ctx(lab("lso-learner-student")));
    assert.ok(result);
    const detail = result.detail as LearningSequenceDetail;
    assert.equal(detail.kind, "learning-sequence");
    assert.equal(detail.evidence, "lab-verified");
    assert.deepEqual(detail.items.map((item) => [item.position, item.title]), [
      [1, "Lab step 1: orientation"],
      [2, "Lab step 2: worksheet"],
      [3, "Lab step 3: reflection"],
    ]);
    assert.equal(detail.items[0]!.description, "Lab seed: synthetic first step.");
    assert.equal(detail.items[0]!.status, "not_started");
    assert.equal(detail.items[0]!.current, true);
    assert.equal(detail.items[1]!.current, undefined);
    // The lab steps carry no object links in the learner view, so no refId or type is invented.
    assert.equal("refId" in detail.items[0]!, false);
  });

  it("returns undefined for pages that are not the learner view", async () => {
    assert.equal(await readLearningSequence(ctx(lab("course-student"))), undefined);
    assert.equal(await readLearningSequence(ctx(lab("sess-info-student"))), undefined);
  });

  it("is registered for lso and read end-to-end through readPage", async () => {
    assert.ok(OBJECT_READERS.lso);
    const url = `${ORIGIN}/go/lso/90`;
    const html = lab("lso-learner-student");
    const pages = { [url]: snapshotFromHtml(url, "Lab lso", html, textOf(html)) };
    const provider = createBrowserProvider({ session: createMemorySession(pages), clock: () => Date.parse("2026-11-17T10:00:00Z") });
    const page = await provider.readPage("90", { type: "lso" });
    assert.equal(page.detailStatus, "read");
    assert.equal((page.detail as LearningSequenceDetail).items.length, 3);
  });
});
