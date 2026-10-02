# Session recovery runbook

Single runbook for the headless ADAM session holder (ADR 0009) and dead-holder
resume (ADR 0017). Background: [architecture.md](architecture.md),
[adr/0009-headless-session-holder.md](adr/0009-headless-session-holder.md),
[adr/0017-live-runtime-only.md](adr/0017-live-runtime-only.md).

## Commands

| Command | What it does | Browser? |
| --- | --- | --- |
| `npm run login` (`adam-mcp login`) | First sign-in. Opens **headed** Chrome on the dedicated profile; the student completes SWITCH edu-ID + MFA in that window. On success it exports the in-memory cookie jar, closes the headed context, writes a transient seed file (mode 0600, unlinked by the holder before Chrome launches), spawns the detached session holder, and returns. | Headed, then closes |
| `adam_session_status` (tool) / `npm run status` (`adam-mcp status`) | Reports `loggedIn`, `reason`, `holderPid`, `checkedAt` **without launching a browser** (always present; plus `currentUrl` / `title` when present). When no holder/CDP is reachable it returns `reason: "login-required"`. Never invents a session. Cold-start: always re-check status after login before listing. | Never launches |
| `npm run logout` (`adam-mcp logout`) | Stops the holder via process-group SIGTERM → SIGKILL (see Platform notes). Refuses "stopped" — and never clears the holder record — while bound Chrome/CDP or `DevToolsActivePort` is still alive. `--purge` also removes the Chrome profile. | Stops Chrome |
| `adam_login` (tool) | Same interactive sign-in as `npm run login` but blocks the tool call (default 10 min). Prefer the CLI when the host has a shell. | Headed, then closes |

`ADAM_BROWSER_HEADED=1` is a debug escape hatch that keeps the headed session
in-process instead of handing off to the holder.

## Dead-holder resume (ADR 0017)

Resume runs **only** when a read tool needs a page (`open` / `fetchAuthorized` /
`probeAuthorized` via `ensurePage({ allowResume: true })`), no holder is
running, and CDP is not attached. It never runs when a holder is already
running, and `adam_session_status` never triggers it.

1. Launch **headless** Chrome on the existing profile (no window, no seed file,
   no password).
2. `goto` the origin, wait for the session to settle, snapshot the page.
3. Dashboard verify (`isLoggedInSnapshot`: logout/dashboard markers or a live
   course link; login screens match `login.php` / "bei adam anmelden" /
   "login mit switch edu-id").
4. Signed in → export the cookie jar, **close that Chrome**, start a new
   session holder (ADR 0009 handoff), attach over CDP, continue the read.
5. Login page → **close Chrome** and fail closed with the existing
   `unauthorized` / `login-required` text. No holder record is written.

## Caches invalidated on login / close

`login()` and `close()` call `clearSessionCaches`: the enrolled walk memo and
inflight walk are dropped, the per-URL page map is cleared, the
`typeByRefId` / `fileByRefId` maps are cleared, and the walk generation is
bumped so a racing in-flight walk cannot re-seed the memo. Ordinary reads never
clear. Cancelled / `unauthorized` / `forbidden` / `stale_id` walks are never
memoized.

## Error taxonomy and recovery copy

| Signal | Meaning | Recovery |
| --- | --- | --- |
| `login-required` / `unauthorized` | No session (`SessionStatus.reason`) or ADAM showing the login page / origin root not signed in / HTTP 401 / no session running (`AdamError`). Same recovery. | Run `adam-mcp login` / `adam_login` / `npm run login` and complete SWITCH edu-ID in Chrome. Do not paste the password into chat. Do not keep searching. After login, re-check `adam_session_status` (cold-start: always re-check status after login before listing), then retry the failed call once. |
| `forbidden` | `AdamError` — ADAM permission page or HTTP 403. Access denied for this account. | Permission denied for this account — the object is **not** reported as missing. Do not retry as `not_found`. |
| `stale_id` | `AdamError` — ADAM opened a different typed ref than requested. | Refresh listings and retry with the current identity — this is not a missing object. Do not reuse the old ref. |

## Diagnostics to include in a bug report

Default `adam-mcp status` / `adam_session_status` always reports `loggedIn`,
`reason`, `holderPid`, `checkedAt` (plus `currentUrl` / `title` when present).

Holder internals (`pid`, `generation`, `pidStartTime`, `exe`, optional bound
`browserPid` + `browserPidStartTime` + `browserExe`) are bug-report-only:
`adam-mcp status --verbose` or `session-holder.json` (bound identity, ADR 0009).
`startedAt`, `verifiedAt`, `origin` also live in the holder record.
A live bound holder must report its PID; stale, dead, or identity-mismatched
records report null/absent and must not claim the holder is alive.

Also useful: whether `DevToolsActivePort` exists, whether CDP answers
`/json/version`, and the exact `unauthorized` / `forbidden` / `stale_id`
message.

Live debugging captures (structure-only, `ADAM_DEBUG_CAPTURE=1` under `scratch/` /
`ADAM_DEBUG_CAPTURE_DIR`) follow the capture / promote rules in
[live-reverify.md](live-reverify.md): never commit `scratch/`.

## Platform notes

- Stop signals the **process group** (falls back to the single PID when the
  PGID is not ours): SIGTERM, 2 s grace, then SIGKILL, up to a 15 s deadline
  (100 ms poll). Chrome may leave `DevToolsActivePort` after SIGKILL; it is
  unlinked only once CDP is dead.
- Stale-record cleanup happens on read: a dead or unbound-PID record is cleared
  **only** when Chrome/CDP is also gone. The record is never cleared — and a
  PID failing the start-time/exe bind is never signaled — while Chrome/CDP is
  still alive.
- Process identity (PID-reuse bind): Linux reads `/proc/{pid}/exe` + `stat`
  starttime; macOS/Unix uses `ps -o lstart= -o args=`; Windows uses WMIC
  `CreationDate`/`ExecutablePath`, then PowerShell `Get-Process`
  `StartTime`/`Path` (Git's `ps` on Windows rejects `-o`, so it is skipped).
- Rotation risk: PIDs get reused, and freshly spawned processes can lag in
  WMIC/Get-Process. The start-time + exe bind (plus the holder `generation`
  UUID) is what keeps stop/status/re-login from signaling or reporting a
  stranger process.
