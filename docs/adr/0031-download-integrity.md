# ADR 0031: Bounded download integrity checks

## Status

Accepted.

## Context

An unsolicited partial response can have a correct length and digest for its
fragment while not being the selected original. Sign-in pages can also be
returned with misleading binary MIME types. Unlimited content inspection would
undermine streaming and resource limits.

## Decision

Reject unsolicited partial responses before delivering content. Inspect at most
4096 prefix bytes for HTML signatures, decoding UTF-8 and BOM-marked UTF-16LE/BE.
This shared heuristic also applies to extraction callers. Explicit HTML MIME is
still rejected. Neither a matching digest nor this heuristic proves completeness
or detects all HTML; longer padding, other encodings and markup may evade it.
Downloads remain bounded and are not automatically opened.

## Consequences

Some legitimate HTML-like originals are refused. The larger but fixed inspection
window and additional encoding support may also refuse more extraction inputs.
No unbounded buffering or arbitrary response execution is introduced.
