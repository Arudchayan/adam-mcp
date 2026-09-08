# ADR 0003 — Session feedback page, then headless continuation

## Context

A raw ADAM dashboard after SWITCH looks unfinished. Students want the window to go away. Closing Chrome without restoring cookies drops ADAM **session-only** cookies (`PHPSESSID` and SWITCH host cookies). Writing `cookies.json` / `storageState` files is forbidden (T4, gitignore, no secrets on disk).

Playwright does not persist session cookies across `launchPersistentContext` restarts by itself (session cookies have no `Expires`).

## Decision

After a successful login **in the process that owns Chrome** (`ownsChrome === true`):

1. Paint the first-party success overlay (~5s). No extra origin, no cookie values in the page.
2. Snapshot `context.storageState()` **in RAM only**. Never log it, never write it, never put it on `SessionStatus`.
3. Close the headed persistent context.
4. Relaunch the **same profile** headless (`channel: "chrome"`), copy the headed `userAgent`, `addCookies` from that RAM snapshot (session cookies as `expires: -1`).
5. `goto https://adam.unibas.ch` and require `isLoggedInSnapshot`. If that fails, report `unauthorized` — do not pretend the student is signed in.

If this process only **attached** via CDP (`ownsChrome === false`), do not steal the profile. Overlay + minimize remains the fallback.

Errors (timeout, stale SWITCH): overlay only; do not close a window the student still needs.

## Consequences

The visible window can disappear. A headless Chrome process stays until the MCP (or login CLI) exits. Force-killing that process still ends the session. Cookie files stay forbidden. This is a session-behavior change; do not regress to dumping jars into tool JSON.
