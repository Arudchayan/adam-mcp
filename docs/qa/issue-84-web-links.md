# Issue #84: Web Link evidence boundary

## Status

**Blocked for destination metadata and the reported listing shape.** This
change adds regression coverage of already-supported URL classification and
page reading, not a runtime fix for the anonymized report. It does not establish
that released 0.2.0 or current code classifies the reporter's listing correctly.
No new MCP tool, destination field, icon inference, external fetch, or inventory
fixture is introduced.

## Evidence examined

- Issue #84 describes an unknown listing child resolving to `webr` on read,
  but supplies neither a refId nor a scrubbed listing/Weblinks-tab capture.
- `docs/capabilities.md` records two historical sightings on 2026-10-02,
  readable as page text through `/go/webr/{id}` (roughly 2.2 KB payloads).
  These are existing documentary observations, **not revalidated live**.
- The five committed `packages/provider-browser/fixtures/live/*.json` snapshots
  contain no `webr`, Web Link GUI-class, or matching historical-ref evidence.
  No Web Link capture was found in the inspected worktree or the main
  workspace's `scratch/` path. Capture-related tracked files are the capture
  implementation/tests and script, not a Web Link capture.
- `docs/ROADMAP.md` requires **both a live refId and a scrubbed capture** before
  expanding Web Links. The historical IDs alone do not satisfy that gate.
  Nothing here accessed private live ADAM or manufactured a live sighting.

The roadmap's previous blanket `webr` wait-for-inventory label contradicted the
later capabilities observations. It is now narrowly reconciled as historically
live-seen for page text, with listing heuristics and destination metadata still
capture-gated. The stop rule is unchanged. There is no runtime behavior change,
so no new ADR is needed for this tests/documentation-only change.

## Existing behavior covered

`packages/core/src/urls.ts` already recognizes `/go/webr/{id}`, ADAM handles,
ADAM goto URLs, and `ilobjlinkresourcegui` / `ilobjweblinkgui` query classes.
`extractCatalog` already retains a typed href over an untyped duplicate, emits
the canonical ADAM object citation, and preserves the source href provenance.
A parent GUI class must not type a distinct `item_ref_id` child.

The new tests use explicitly synthetic URL-contract inputs, **not a fixture
mirror of enrolled Web Link inventory**. Browser-provider tests cover listing,
duplicate order, ambiguous references, foreign-link exclusion, provenance, and
the existing unknown-ref-to-typed-page read path without external navigation,
byte fetches, or metadata probes. They do not prove real Weblinks-tab extraction
or exercise the MCP confirmation gate (which is unchanged).

## What is needed to unblock

1. A permitted enrolled Web Link refId paired with a scrubbed capture of its
   containing listing (including the title href and row-local type/icon signals)
   and its ADAM Weblinks tab (including actual destination markup).
2. Capture provenance tying those surfaces to the same object and observation;
   remove credentials, session query values, personal/course content, and any
   sensitive destination tokens. Do not commit raw private captures.
3. Determine whether the listing offers a recognized typed URL, a row-local
   type signal, or genuinely needs resolution. Do not guess from its title,
   a neighboring icon/link, or a parent GUI class.
4. Only after the gate is met, mirror the observed scrubbed shape and write an
   ADR for the changed read contract: destination metadata must be explicitly
   untrusted, attributed to the ADAM source page and observation time, scheme-
   checked/redacted, bounded, and never fetched or followed. Preserve the
   existing confirmation gate, origin pin, and canonical ADAM citation.

## Validation

- `npm test`: 577 passed, 0 failed (10 added URL-contract tests).
- `npm run typecheck`, `npm run build`, `npm run test:dist`: passed.
- `git diff --check`: passed.

Suggested truthful issue response:

> Current code already recognizes explicitly typed Web Link URLs; regression
> tests now cover those paths and existing page reads without external fetches.
> This does not yet fix the reported unknown listing or expose destinations.
> Our inventory gate still needs a permitted refId plus scrubbed listing and
> Weblinks-tab evidence. Historical IDs exist in the repository notes, but no
> matching capture is available, so destination parsing remains blocked.
