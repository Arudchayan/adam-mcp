# ADR 0047: Extract page windows, notebooks, uploaded HTML and the size-limit hint

## Status

Accepted

## Context

Issue #121 reported four practical gaps in `adam_extract_file_text` on 0.4.0:

- Pages after the first 20 of a PDF could never be read.
- Uploaded `.html` course files were rejected as if ADAM had returned a web page.
- `.ipynb` notebooks, which are UTF-8 JSON, were rejected.
- Files over the 8 MiB cap failed with `recoveryAction: "check_installation"`.

## Decision

- **Page windows.** `startPage` (1-based, default 1) selects the first PDF page, and `maxPages` still bounds the window to at most 20. Parsing still happens only in the isolated worker under the same byte, page, character and time limits. Results keep real page numbers and add `nextStartPage` when pages remain. A `startPage` past the last page fails with `unsupported_type` and names the page count.
- **Notebooks.** A file whose title ends in `.ipynb` is parsed as JSON. The result contains only cell sources, each labelled with its cell type. Outputs are omitted, since they can be large embedded media. Invalid JSON, or a notebook with no cells, fails closed.
- **Uploaded HTML.** HTML bytes are extracted only when the response's own `Content-Disposition` names an `.html`/`.htm` file. ADAM's login, error and info pages never carry a filename, so they are still refused as web pages. Extraction returns visible text only: scripts, styles, comments, head, markup and attributes are removed. The text is untrusted, like every extract.
- **Size limit.** Exceeding the 8 MiB extract cap is `unsupported_type`, which maps to `check_object_or_format`, and the message suggests `adam-mcp download`. The 256 MiB download cap is unchanged.

## Consequences

No new tool is added, and file bytes are still never returned. Older callers that send no `startPage` see the same results as before, plus the optional `nextStartPage`. `.pptx` extraction would need a zip/XML parser dependency and is not included. Unknown tool arguments are still stripped by schema validation, not rejected.
