# ADR 0035: Correlate discovery listing evidence

## Status

Accepted.

## Context

An empty or unresolved listing can contain incidental links, and visible item rows
do not corroborate links in navigation or a different content region. Retaining
raw children in an enrolled walk could expose those suppressed identities in
search even though listing and traversal correctly rejected them.

## Decision

Retain child identities in walk catalogs only when the same snapshot classifies
as a successful listing. Keep the current page, text, dates and news so body
matches and aggregation remain available; retain existing partial reporting.
In the browser, use the listing probe's content root for link eligibility,
exclude navigation and sidebars, and associate links with recognized rows in
their own document. Standalone links recognized by the probe remain
eligible. Same-origin frames are still collected; a chrome duplicate must not
mask a content link. Cross-origin frames remain excluded.

## Consequences

Unparsed rows remain unknown rather than being corroborated by unrelated links.
Unrecognized layouts may require updated selectors; absence of recognized
evidence is not interpreted as an empty listing. Memory snapshots without DOM
evidence retain their existing fixture behavior.
