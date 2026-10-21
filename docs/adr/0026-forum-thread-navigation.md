# ADR 0026 — Construct forum thread navigation from requested IDs

Date: 2026-10-21. Status: accepted.

## Context

Forum listing hrefs are untrusted page content. The thread resolver previously
accepted an HTTPS href containing a matching `thr_pk` and no command, including
`/logout.php?thr_pk=200002`. The browser opened that authenticated destination
before checking the landed forum and thread identity. Origin checks alone do
not prevent actions on ADAM itself, and post-navigation checks cannot undo them.

## Decision

- Construct the thread destination using only the requested decimal forum ref
  and thread IDs, the pinned `https://adam.unibas.ch` origin, `/ilias.php`, and
  the existing `baseClass=ilrepositorygui`, `cmdClass=ilobjforumgui`,
  `cmd=viewThread`, `ref_id`, and `thr_pk` parameters.
- The resolver accepts no source href. Page paths, commands, extra parameters,
  duplicate or encoded keys, foreign origins, and fragments cannot contribute
  to this destination. Parsed hrefs remain untrusted listing metadata.
- Reject malformed requested IDs with `stale_id` and a non-pinned configured
  origin with `forbidden` before opening the overview or thread. Keep IDs as strings;
  do not truncate or numerically coerce them.
- Preserve the MCP student approval gate and the existing landed-identity
  checks. Missing posts still return `not_found`; a different landed forum or
  thread still returns `stale_id`.

## Consequences and validation

Thread reads use the known supported route even when the listing contains
alternate or malicious links. Link-specific pagination and other query state
are intentionally discarded. Listing parsing remains heuristic and can still
report misleading untrusted titles or IDs; those hrefs cannot select navigation.
This does not add write operations or promise that upstream thread reads have
no incidental ADAM read-state effects.

Memory-session regressions assert the exact opened URLs for logout/action,
foreign-host, mismatched-forum, encoded/duplicate-parameter and fragment links,
alongside a legitimate listing link. Malformed IDs cause zero opens. Existing
forum parsing, post identity and provider tests exercise normal reads. No live
network request or user profile is needed for these checks.
