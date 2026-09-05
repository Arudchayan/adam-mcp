import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "./errors.ts";
import { extractLocalFileText, looksLikeHtml, MAX_EXTRACT_BYTES } from "./local-extract.ts";
import { syntheticPdfWithText } from "./synthetic-pdf.ts";
import type { FileObject } from "./types.ts";

const file: FileObject = {
  type: "file",
  refId: "100011",
  title: "00_Overview.pdf",
  url: "https://adam.unibas.ch/go/file/100011",
  breadcrumb: [],
  mimeType: "application/pdf",
  provenance: {
    sourceUrl: "https://adam.unibas.ch/go/file/100011",
    fetchedAt: "2026-09-05T12:00:00.000Z",
    provider: "fixture",
  },
};

describe("extractLocalFileText", () => {
  it("returns bounded page text and sha256, never file bytes", async () => {
    const bytes = syntheticPdfWithText("Multimedia retrieval ranking");
    const extracted = await extractLocalFileText(file, bytes, "application/pdf");
    assert.match(extracted.pages[0]?.text ?? "", /Multimedia retrieval ranking/);
    assert.equal(extracted.sha256.length, 64);
    assert.equal("bytes" in extracted, false);
    assert.equal("blob" in extracted, false);
    assert.doesNotMatch(JSON.stringify(extracted), /%PDF-/);
  });

  it("extracts plain text files", async () => {
    const extracted = await extractLocalFileText(
      { ...file, mimeType: "text/plain", title: "notes.txt" },
      Buffer.from("plain notes"),
      "text/plain",
    );
    assert.equal(extracted.pages[0]?.text, "plain notes");
  });

  it("rejects oversized payloads", async () => {
    await assert.rejects(
      () => extractLocalFileText(file, new Uint8Array(MAX_EXTRACT_BYTES + 1), "application/pdf"),
      (error: unknown) => {
        assert.ok(error instanceof AdamError);
        assert.equal(error.code, "provider_unavailable");
        return true;
      },
    );
  });

  it("detects HTML so callers can skip login pages", () => {
    assert.equal(looksLikeHtml(Buffer.from("<!DOCTYPE html><html></html>"), "text/html"), true);
    assert.equal(looksLikeHtml(syntheticPdfWithText("x"), "application/pdf"), false);
  });
});
