import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "./errors.ts";
import { extractLocalFileText, htmlFileText } from "./local-extract.ts";
import { syntheticPdfWithPages } from "./synthetic-pdf.ts";
import type { FileObject } from "./types.ts";

const fileNamed = (title: string, mimeType?: string): FileObject => ({
  type: "file", refId: "100011", title, url: "https://adam.unibas.ch/go/file/100011", breadcrumb: [], mimeType,
  provenance: { sourceUrl: "https://adam.unibas.ch/go/file/100011", fetchedAt: "2026-11-14T00:00:00Z", provider: "browser" },
});
const pdf = fileNamed("Slides.pdf", "application/pdf");
const bytes = (text: string) => new TextEncoder().encode(text);
const unsupported = (pattern: RegExp) => (error: unknown) =>
  error instanceof AdamError && error.code === "unsupported_type" && pattern.test(error.message);

describe("#121 PDF page windows", () => {
  const five = syntheticPdfWithPages(["Page one", "Page two", "Page three", "Page four", "Page five"]);

  it("reads from page 1 by default and points at the next page", async () => {
    const result = await extractLocalFileText(pdf, five, "application/pdf", 2);
    assert.deepEqual(result.pages.map((page) => page.page), [1, 2]);
    assert.equal(result.pageCount, 5);
    assert.equal(result.truncated, true);
    assert.equal(result.nextStartPage, 3);
  });

  it("continues from startPage with real page numbers", async () => {
    const result = await extractLocalFileText(pdf, five, "application/pdf", 2, undefined, { startPage: 3 });
    assert.deepEqual(result.pages.map((page) => page.page), [3, 4]);
    assert.match(result.pages[0]!.text, /Page three/);
    assert.equal(result.nextStartPage, 5);
  });

  it("ends the window at the last page without a next page", async () => {
    const result = await extractLocalFileText(pdf, five, "application/pdf", 8, undefined, { startPage: 5 });
    assert.deepEqual(result.pages.map((page) => page.page), [5]);
    assert.equal(result.truncated, false);
    assert.equal(result.nextStartPage, undefined);
  });

  it("rejects a startPage beyond the last page", async () => {
    await assert.rejects(() => extractLocalFileText(pdf, five, "application/pdf", 2, undefined, { startPage: 6 }), unsupported(/beyond the last page \(5\)/));
  });
});

describe("#121 Jupyter notebooks", () => {
  const notebook = JSON.stringify({
    cells: [
      { cell_type: "markdown", source: ["# Exercise 1\n", "Load the data."] },
      { cell_type: "code", source: "import pandas as pd", outputs: [{ data: { "image/png": "iVBORw0KGgo=".repeat(100) } }] },
    ],
    metadata: {}, nbformat: 4, nbformat_minor: 5,
  });

  it("returns cell sources only, by filename even when served as octet-stream", async () => {
    const result = await extractLocalFileText(fileNamed("template.ipynb", "application/octet-stream"), bytes(notebook), "application/octet-stream");
    assert.equal(result.pages.length, 1);
    assert.match(result.pages[0]!.text, /\[markdown\]\n# Exercise 1\nLoad the data\./);
    assert.match(result.pages[0]!.text, /\[code\]\nimport pandas as pd/);
    assert.doesNotMatch(result.pages[0]!.text, /iVBOR/, "outputs and embedded media are omitted");
  });

  it("fails closed on a non-notebook .ipynb", async () => {
    await assert.rejects(() => extractLocalFileText(fileNamed("broken.ipynb"), bytes("not json"), "application/octet-stream"), unsupported(/not valid JSON/));
    await assert.rejects(() => extractLocalFileText(fileNamed("odd.ipynb"), bytes("{}"), "application/json"), unsupported(/no cells/));
  });
});

describe("#121 uploaded HTML files", () => {
  const html = `<!doctype html><html><head><title>t</title><style>.x{}</style><script>alert(1)</script></head>
<body><h1>Lecture 3</h1><p>Gradient &amp; descent&nbsp;basics</p><!-- hidden --><pre>x = 1</pre><a href="javascript:void(0)">link text</a></body></html>`;

  it("extracts visible text without scripts, styles, comments or markup", async () => {
    const result = await extractLocalFileText(fileNamed("lecture3.html", "text/html"), bytes(html), "text/html;charset=UTF-8", 8, undefined, { uploadedHtml: true });
    const text = result.pages[0]!.text;
    assert.match(text, /Lecture 3\nGradient & descent basics\nx = 1/);
    assert.match(text, /link text/);
    assert.doesNotMatch(text, /alert|\.x\{|hidden|<|javascript:/);
  });

  it("still refuses HTML that is not a named uploaded file", async () => {
    await assert.rejects(() => extractLocalFileText(fileNamed("lecture3.html"), bytes(html), "text/html"), unsupported(/not text\/html/));
  });

  it("decodes numeric entities and ignores invalid code points", () => {
    assert.equal(htmlFileText("<p>&#x41;&#66;&#0;&#x110000;C</p>"), "AB C");
  });
});
