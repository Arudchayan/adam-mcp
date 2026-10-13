# Read reliability and session regression coverage

All automated checks use synthetic data or committed scrubbed captures. No live
ADAM credentials, course files or private screenshots are needed.

| Requirement | Regression evidence |
| --- | --- |
| Correct labelled deadlines, real dates, Zurich winter/summer clocks and DST ambiguity | `provider-browser/src/deadlines.test.ts`, AT5 browser tests |
| Unknown courses and nested folders remain incomplete across search/calendar/news | `provider-browser/src/unknown-walk.test.ts` |
| One-minute refresh, stable query-bound pagination, cursor expiry and logout blocking cached reads | `provider-browser/src/cache-freshness.test.ts` |
| Real PDF pages, compressed streams, metadata exclusion, page/character/byte caps and active/queued cancellation | `core/src/local-extract.test.ts` |
| Session/auth/OTP identifiers and URL/structured carriers cannot bypass redaction | `mcp/src/redaction-adversarial.test.ts` (blocking, no TODO exclusions) |
| Streaming limits before buffering, exact byte boundary, redirect origin and cancellation | `provider-browser/src/bounded-fetch.test.ts` |
| No-window login reuse, closed-window cancellation, bounded waiting, no SWITCH snapshots and explicit logout | `provider-browser/src/login-flow.test.ts` |
| PID binding, holder startup/shutdown races and cancelled-walk recovery | existing holder/race/session suites |
| Built CLI resolves its PDF worker outside the repository and keeps stdout JSON-RPC-only | `scripts/verify-dist.mjs` |
| No write tools, exam denial, body confirmation and fixture-only test harness | existing MCP facade, stdio and provider suites |

Run `npm run check` for tests, strict typechecking, build, distribution verification
and production dependency audit. CI runs the distribution check after build on
Windows, macOS and Linux with Node 20 and 22. Compiler checks reject unused locals
and parameters. PDF tests additionally support the declared Node 20 baseline.

Pattern-based redaction is not a general personal-information detector. Ambiguous
human titles and unlabeled prose secrets remain documented limits. PDF OCR,
formula interpretation and visual layout reconstruction remain unsupported.

For a live user-side check after rebuilding: login twice (second call opens no
window), close an unfinished login window (call ends), then logout and try a read
(it requires login rather than silently resuming). A fresh-window login and its
headless handoff still require the user's own SWITCH session; CI does not claim
to verify the current live authentication UI.
