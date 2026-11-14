import assert from "node:assert/strict";
import { it } from "node:test";
import { isUploadedHtmlFile } from "./browser-provider.ts";

it("#121: only a response naming an .html/.htm file is an uploaded HTML course file", () => {
  assert.equal(isUploadedHtmlFile('attachment; filename="Lecture 3.html"'), true);
  assert.equal(isUploadedHtmlFile("inline; filename=notes.HTM"), true);
  assert.equal(isUploadedHtmlFile("attachment; filename*=UTF-8''Vorlesung%203.html"), true);
  assert.equal(isUploadedHtmlFile('attachment; filename="slides.pdf"'), false);
  assert.equal(isUploadedHtmlFile("inline"), false, "ADAM login/error pages carry no filename");
  assert.equal(isUploadedHtmlFile(undefined), false);
});
