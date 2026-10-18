# ADR 0025 — Local onboarding, session clarity and scoped read controls

Status: accepted for implementation, 2026-10-13.

## Decision

Keep stdio, local Chrome authentication, the pinned ADAM origin and all existing
body confirmation gates. Add packaged `setup` and passive `doctor` CLI commands.
Setup defaults to preview; `--write` explicitly installs one selected client's
configuration, preserving other entries and backing up the original. Login and
course verification run only with `--login`. Use the absolute Node executable
and built entry point, avoiding shell launchers and PATH dependence. Codex gets
a 2,100-second tool timeout to cover the maximum 30-minute login plus five minutes
for queue waiting, browser startup, verification and cleanup;
long read operations retain their existing two-minute server budget. Other hosts
must be documented with verified timeout behavior rather than invented fields.

Status remains passive and backward compatible in its `reason` field. Add a
separate connection state and recovery action for explicit logout, inactive saved
profile (unverified), sign-in in progress and verified connection. File existence
never proves authentication. Login reports safe progress stages without inspecting
SWITCH credential forms or recording credentials.

Add structured, redacted errors alongside existing text. Add optional enrolled
`courseRefId` and `refresh` on search/calendar/news. Validate membership against
the dashboard before opening the scoped course. Scoped walks do not include
dashboard results or other courses. Scope binds pagination; refresh starts a new
listing and cannot be combined with a cursor. Refresh invalidates read caches,
not the authenticated session. Listing snapshots report their creation time;
existing per-item provenance retains the actual fetch time. Partial reads report
coverage reasons without claiming absence.

## Validation

Synthetic tests cover configuration preservation/refusal/backup, paths with
spaces, passive diagnostics/session states, scope authorization and reduced
navigation, refresh/cursor behavior, and structured error redaction. Run full
checks and clean tarball verification. Dated actual host and live ADAM evidence
is a separate readiness gate; do not claim those checks from fixture results.

## Limits

No new MCP tools, hosted listener, credential handling, automatic background
monitoring, writes to ADAM or new object types. Packaging/configuration writes
are local CLI actions. Do not publish/tag until SECURITY and CI gates hold.
