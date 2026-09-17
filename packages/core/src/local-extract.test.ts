import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "./errors.ts";
import {
  assertExtractHasText,
  extractLocalFileText,
  extractPagesHaveText,
  looksLikeHtml,
  MAX_EXTRACT_BYTES,
  MAX_EXTRACT_CHARS,
} from "./local-extract.ts";
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
        assert.equal(error.retryable, false);
        return true;
      },
    );
  });

  it("detects HTML so callers can skip login pages", () => {
    assert.equal(looksLikeHtml(Buffer.from("<!DOCTYPE html><html></html>"), "text/html"), true);
    assert.equal(looksLikeHtml(Buffer.from("  <form action='/login'>Sign in</form>"), "text/plain"), true);
    assert.equal(looksLikeHtml(Buffer.from("<?xml version='1.0'?>")), true);
    assert.equal(looksLikeHtml(Buffer.from("<html lang='de'></html>")), true);
    assert.equal(looksLikeHtml(Buffer.from("<script>alert(1)</script>")), true);
    assert.equal(looksLikeHtml(Buffer.from(`${"x".repeat(200)}<form action='/login'>`)), true);
    assert.equal(looksLikeHtml(Buffer.from(`${"x".repeat(1_100)}<form action='/login'>`)), false);
    assert.equal(looksLikeHtml(Buffer.from("%PDF-1.4"), undefined), false);
    assert.equal(looksLikeHtml(syntheticPdfWithText("x"), "application/pdf"), false);
  });

  it("rejects a malformed PDF payload", async () => {
    await assert.rejects(
      () => extractLocalFileText(file, Buffer.from("%PDF-not-a-real-document"), "application/pdf"),
      (error: unknown) => error instanceof AdamError && error.code === "unsupported_type",
    );
  });

  it("fails closed instead of silent empty text after extract", async () => {
    await assert.rejects(
      () =>
        extractLocalFileText(
          { ...file, mimeType: "text/plain", title: "empty.txt" },
          Buffer.from(""),
          "text/plain",
        ),
      (error: unknown) => {
        assert.ok(error instanceof AdamError);
        assert.equal(error.code, "unsupported_type");
        assert.equal(error.retryable, false);
        assert.match(error.message, /no extractable text/i);
        assert.doesNotMatch(error.message, /%PDF-/);
        return true;
      },
    );
    await assert.rejects(
      () =>
        extractLocalFileText(
          { ...file, mimeType: "text/plain", title: "blank.txt" },
          Buffer.from("   \n\t  "),
          "text/plain",
        ),
      (error: unknown) => error instanceof AdamError && error.code === "unsupported_type",
    );
  });

  it("fails closed with a cap reason when truncation leaves only empty text", async () => {
    const whitespace = " \n".repeat(MAX_EXTRACT_CHARS);
    await assert.rejects(
      () =>
        extractLocalFileText(
          { ...file, mimeType: "text/plain", title: "spaces.txt" },
          Buffer.from(whitespace),
          "text/plain",
        ),
      (error: unknown) => {
        assert.ok(error instanceof AdamError);
        assert.equal(error.code, "provider_unavailable");
        assert.equal(error.retryable, false);
        assert.match(error.message, /no text within/i);
        assert.match(error.message, new RegExp(String(MAX_EXTRACT_CHARS)));
        return true;
      },
    );
  });

  it("sets truncated when character cap keeps real text", async () => {
    const body = "Multimedia retrieval ranking ".repeat(2_000);
    assert.ok(body.length > MAX_EXTRACT_CHARS);
    const extracted = await extractLocalFileText(
      { ...file, mimeType: "text/plain", title: "notes.txt" },
      Buffer.from(body),
      "text/plain",
    );
    assert.equal(extracted.truncated, true);
    assert.equal(extracted.pages[0]?.text.length, MAX_EXTRACT_CHARS);
    assert.match(extracted.pages[0]?.text ?? "", /Multimedia retrieval ranking/);
    assert.equal("bytes" in extracted, false);
  });

  it("assertExtractHasText rejects silent empty and accepts real text", () => {
    assert.equal(extractPagesHaveText([{ text: "" }]), false);
    assert.equal(extractPagesHaveText([{ text: "  \n" }]), false);
    assert.equal(extractPagesHaveText([{ text: "Overview" }]), true);
    assert.throws(
      () => assertExtractHasText({ pages: [{ page: 1, text: "" }], truncated: false }),
      (error: unknown) => error instanceof AdamError && error.code === "unsupported_type",
    );
    assert.throws(
      () => assertExtractHasText({ pages: [{ page: 1, text: "  " }], truncated: true }, 8),
      (error: unknown) =>
        error instanceof AdamError &&
        error.code === "provider_unavailable" &&
        /8-page/.test(error.message),
    );
    assert.doesNotThrow(() =>
      assertExtractHasText({ pages: [{ page: 1, text: "Lecture notes" }], truncated: false }),
    );
  });
});
