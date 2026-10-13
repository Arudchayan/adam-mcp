# ADR 0022 — Bounded transfers and page-aware PDF extraction

## Context

Raw PDF string matching could present metadata as page text, miss compressed
streams and attribute an entire document to page one. The 8 MiB transfer cap
was checked only after Playwright buffered a response.

## Decision

Use PDF.js 4.10.38, pinned for the documented Node 20 baseline, in an isolated
worker. The latest major requires a newer Node baseline and is not selected
implicitly. The worker accepts local bytes only, disables eval/XFA/font rendering
and worker fetches, and streams text from actual pages. Parser stdout/stderr are
consumed privately. It has a 128 MiB JavaScript heap limit and a 20-second deadline;
these are bounds, not a guarantee on total native memory. Cancellation terminates
the worker. No document scripts or URLs are executed by this extraction path.
Only one parser runs per process; queued extraction can be cancelled independently.

Actual PDF page count replaces listing hints. Page numbers come from PDF.js.
Limits remain 8 MiB, 40,000 characters, default eight pages and maximum twenty
real pages. Truncation is explicit; blank or malformed PDFs fail closed. OCR,
layout-perfect reconstruction and mathematical formula interpretation remain
unsupported. Parser failures never expose document diagnostics to clients.

The build copies the worker into the distribution and declares PDF.js as a
runtime dependency. The dependency and license appear in NOTICE.

File transfers use a streaming fetch with browser-context cookies scoped to each
ADAM URL. Every redirect is checked before sending credentials; off-origin
redirects fail closed. Declared oversized bodies are rejected before reading;
chunked/decompressed streams are cancelled as soon as they exceed the cap.
Transfers have a 45-second timeout and caller cancellation. HEAD responses are
disposed after collecting metadata. No generic fetch tool is added.

## Verification

Generated valid PDFs include multiple pages, compressed streams and metadata
that must never become page text. Tests cover the real page cap, cancellation,
malformed/blank documents, chunked and declared oversize, exact byte boundary,
redirect pinning and the built stdio distribution.

Reference: [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
