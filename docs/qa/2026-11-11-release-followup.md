# Release follow-up: selected live listing evidence

Date: 11 November 2026. Student authorized normal read-only inspection and
completed Chrome sign-in. No credentials, raw page captures, private titles,
live object identities, destination values or file bytes are recorded here.

## Web Links (#84)

- A selected containing-course listing advertises row-local
  `ilLinkResourceHandlerGUI` / `calldirectlink` anchors.
- The selected Web Link page advertises a content-table `callLink` anchor with
  numeric same-object and link identities. The external URL is not literal page
  text or an external anchor.
- One selected internal ADAM GET, with redirects disabled, returned HTTP 302
  and an HTTPS external Location. No external request was made.
- Matched structural projections, with masked text and remapped identities, are
  in `packages/provider-browser/qa/weblink-captures/selected-link.json`.
- The implemented source-build live check classified that selected listing item
  as `webr` and returned one destination, using one ADAM redirect request and zero
  external fetches. The destination was a public repository identity; its public
  path survived the conservative output policy. No destination values were
  printed or saved in the report.

Limits: only the observed launch route is resolved, at most eight links per
approved page. Query strings, fragments and unrecognized pathname schemas are
omitted to avoid exposing bearer capabilities. Use the returned ADAM source URL
to open an exact launch link. This is not full-fidelity arbitrary destination
extraction or permission to fetch external resources.

## Practical exercise folder (#86)

A current practical exercise folder returned the specific nonretryable
`blank_content; content_tab_recovery=unavailable` diagnostic on source main.
Normal Chrome navigation, including following its advertised selected Content
tab, also showed an empty content region: zero text, zero item rows, no content
iframes and no explicit empty-folder or denied-access message. No visible child
entries were available for the parser to recover in that sample.

This observation corroborates returning an unresolved inventory diagnostic,
**not** an invented empty inventory or a claim of denied access. It does not
establish the cause of ADAM's blank rendering. The original four reported folder
identities are still unconfirmed, so #86 remains open for their owner to verify.
No speculative selector or empty-folder inference was added on this evidence.
