import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSearchNeedle, searchTitleHit } from "./search.ts";

describe("searchTitleHit pdf extension awareness", () => {
  it("matches type=file for pdf / PDF / .pdf even when the title omits the extension", () => {
    const file = { type: "file", title: "Lecture notes" };
    for (const query of ["pdf", "PDF", ".pdf"]) {
      assert.equal(
        searchTitleHit(normalizeSearchNeedle(query), file),
        true,
        `${query} must title-rank an existing file object`,
      );
    }
  });

  it("does not invent absent types for pdf queries", () => {
    const needle = normalizeSearchNeedle("pdf");
    assert.equal(searchTitleHit(needle, { type: "fold", title: "Notes" }), false);
    assert.equal(searchTitleHit(needle, { type: "crs", title: "Seminar" }), false);
    assert.equal(searchTitleHit(needle, { type: "sess", title: "Lecture" }), false);
    assert.equal(searchTitleHit(needle, { type: "webr", title: "Reading list" }), false);
    assert.equal(searchTitleHit(needle, { type: "tst", title: "Written exam" }), false);
  });

  it("keeps ordinary title matching for non-extension queries", () => {
    assert.equal(
      searchTitleHit(normalizeSearchNeedle("Fourier"), { type: "crs", title: "Fourier analysis" }),
      true,
    );
    assert.equal(
      searchTitleHit(normalizeSearchNeedle("Fourier"), { type: "file", title: "Lecture notes" }),
      false,
    );
  });
});
