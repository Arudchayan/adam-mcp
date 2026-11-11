# ADR 0030: Bounded folder listing recovery and specific unknown diagnostics

Status: Accepted (issue #86)

## Evidence and limits

Issue #86 reports four practical folders returning `unknown` and generic ILIAS
chrome under 0.2.0. Existing scrubbed `folder-blank-exercises` and
`folder-blank-notes` captures reproduce blank content, but remove scripts and
most text. They cannot establish why a live folder was blank or whether it
advertised a Content tab. No private live ADAM access was used for this change.

The code path did select Content/Inhalt for courses, but not folders. Readiness
waited only for main-document rows/empty copy, although snapshot collection and
probes also read same-origin frames. Those are verified implementation gaps,
not a confirmed explanation of the four reported folders.

## Decision

- After the initial bounded listing wait, an unresolved same-folder landing may
  follow **one advertised** Content/Inhalt tab anchor. Only the pinned ADAM
  origin, `/ilias.php`, same `ref_id`, `ilObjFolderGUI`, and explicit `render` or
  `view` commands qualify. Query keys are allowlisted, duplicates rejected;
  arbitrary buttons, URLs and guessed GUI commands are never used. This is
  deliberately conservative: an unfamiliar tab route gets a diagnostic instead.
- The extra navigation has a 15-second DCL timeout and a five-second readiness
  bound. It remains inside the serialized, cancellable operation and the walk's
  existing two-minute budget. Cancellation closes only the active navigation
  tab. It does not change authentication, holder/profile ownership or login.
- Readiness also checks up to 20 immediately embedded same-origin documents so
  delayed content-frame hydration can satisfy the existing wait. Off-origin
  frames are not inspected. Existing snapshot and retention bounds remain.
- Blank content includes textless wrapper-only DOM, but is **never empty**.
  DOM empty evidence uses standalone message lines within the content root,
  rather than matching arbitrary prose. With a DOM probe available, its scoped
  empty signal takes precedence over whole-page empty-copy matching.
- If a real browser folder remains unknown, fail with nonretryable
  `provider_unavailable`, a reason (`blank_content`, `unparsed_rows`, or
  `no_listing_evidence`), whether tab recovery was attempted, and explicit manual
  Content/Inhalt inspection/reporting instructions. Do not infer access denial,
  absence, empty children, or deadlines. Auth/permission/failure/different-object
  landings retain existing provider error precedence, including denied `tst`.
- The session error applies equally to children/files/page/resource consumers.
  Existing memory-provider and facade `unknown` responses remain valid and
  retain their unknown/no-total semantics. Errors do not seed page, listing or
  walk caches. Verified populated/explicit-empty results keep existing caches
  and pagination behavior.
- Walks distinguish unknown listings (including the new session error) from
  other unreadable pages in `partialReasons`. Neither partial result is memoized.

## Verification

Tests cover synthetic session recovery, child/file parity, denied tests,
conservative URL validation, cancellation during recovery, auth/error precedence,
unresolved errors and cache non-reuse, historical scrubbed blank fixtures, and
unknown/mixed walk reasons. The real-DOM opt-in test launches disposable Chrome,
blocks service workers and intercepts every request with synthetic content; it
does not use an ADAM login or profile. It executes the actual probe against
wrapper blanks, unrelated prose, populated rows and delayed same-origin frames.

Run the optional DOM check with `ADAM_TEST_CHROME=1` and
`node --import tsx --test packages/provider-browser/src/folder-listing-dom.test.ts`
(installed Chrome required). Normal tests do not require Chrome.

This improves supported recovery and diagnosability; it does **not** claim that
the four live folders are now inventoried. Their owner must verify that result.
