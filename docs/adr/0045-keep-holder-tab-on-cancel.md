# ADR 0045: Never close the headless holder's last tab on cancellation

## Status

Accepted

## Context

Issues #118 and #126 reported that the headless ADAM session dropped to `login.php` right after a multi-page read (`adam_search`, `adam_list_news`, `adam_list_calendar`) hit its 120-second budget. It happened in 3 of 3 live sessions, while a normal browser session stayed signed in.

When the walk budget (or any other cancellation) aborts an in-flight `open()`, ADR 0024 closes only the current tab so the navigation stops promptly. That tab is usually the holder's only tab. A local, synthetic reproduction (loopback server, disposable profile, no ADAM) shows that closing the last tab of a headless persistent Chrome context ends Chrome's browser session and **purges every session cookie**. Persistent cookies survive, and so do session cookies when any other tab stays open. ADAM's sign-in cookies are session cookies, so the holder process stays alive but is signed out until the next `adam-mcp login`.

## Decision

A cancelled navigation retires its tab with `retireNavigationTab`:

1. If another open tab exists in the context, close the cancelled tab.
2. Otherwise, open a blank replacement tab first, then close the cancelled tab.
3. If no replacement opens within 5 seconds, keep the tab and stop the navigation by going to `about:blank`. The last tab is never closed.

The serialized queue still holds its slot until retirement finishes (ADR 0024), so the next read reuses the replacement tab and never runs alongside the cancelled one. Context, holder and Chrome lifetimes are unchanged. `about:blank` causes no network request and needs no origin allowance.

## Consequences

Time-budget partial results and user cancellations no longer sign the student out. A synthetic unit test covers the three branches. An opt-in real-Chrome regression test (`ADAM_TEST_CHROME=1`) checks that a session cookie survives a cancelled navigation on the only tab, and it fails with the previous `page.close()`. Neither test accesses ADAM.

The invariant is enforced by the attaching session, not the holder. Another client attached over CDP, such as an older build, can still close the last tab. A holder-owned keep-alive tab would need tab selection to skip it, so that is left for a follow-up.

The live sign-out still needs to be re-checked on a source build against the original reports. This decision does not make walks faster and does not change the 120-second budget. Sessions that were already signed out need one `adam-mcp login`.
