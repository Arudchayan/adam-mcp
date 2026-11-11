# ADR 0042: Selected Web Link destination metadata

## Status

Accepted after independent boundary review; release verification remains required.

## Evidence

Student-authorized live inspection on 11 November 2026 observed row-local
`ilLinkResourceHandlerGUI` / `calldirectlink` listing anchors. On the selected
Web Link page, a content table advertises an internal `callLink` anchor with a
same-object `ref_id` and numeric `link_id`. The literal external destination is
not present in that page. Reading that specific ADAM launch route with redirects
disabled returned HTTP 302 with an HTTPS external Location. The destination
was never requested. The matched listing/table structural projections are in
`packages/provider-browser/qa/weblink-captures/selected-link.json`; all text is
masked and identities remapped, with no raw HTML or destination values saved.

## Decision

Classify the observed unambiguous row-local listing handler as `webr`, without
changing stronger existing command-class identities or parent/child rules.
After an approved `adam_read_page` resolves the selected object as `webr`, resolve
at most eight advertised, same-object read-only `callLink` routes. Validate origin,
path, GUI classes, command, numeric identities, query keys and duplicate keys
before acquiring cookies. Make one ADAM GET with redirects disabled and inspect
only its status/Location; cancel the body. Never navigate or fetch the destination.
Return only credential-free HTTPS external redirect metadata, redacted by the
existing URL policy, alongside ADAM source provenance and explicit limitations.
All destination query strings and fragments are omitted, including unknown
vendor-signed credentials. The response explicitly directs students to ADAM for
an exact launch link when those components matter. Recognized ADAM/SWITCH sign-in
redirects return unauthorized, not a purported course destination.
Unknown pathname schemas are also omitted, because bearer invitation/download
credentials can live in a path. Only a constrained GitHub owner/repository
identity retains its public path; other destinations expose their HTTPS origin
and validated internal ADAM source URL. This intentionally limits URL fidelity:
the selected ADAM launch link, not an origin-only metadata URL, is the reliable
way to open those resources. This is not full-fidelity destination extraction.

No new MCP tool, external-fetch facility, automatic listing resolution, or body
approval bypass is introduced. Unsupported/incomplete routes remain explicitly
unresolved; they are not guessed from titles or adjacent prose. Authentication,
permission and transient upstream failures keep their error semantics.
