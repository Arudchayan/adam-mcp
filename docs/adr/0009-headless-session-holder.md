# ADR 0009 - Supervised headless session; login returns

## Context

The interactive login process used to **own** the headless Chrome session and stay
alive waiting for SIGINT; killing it killed the session. The MCP server attached
over CDP, so a host restart only worked while that terminal process lived. Users
disliked both the open browser window and the terminal babysitting, and there was
no `logout`. The design review flagged headed-by-default cold starts (windows
appearing outside login), reactive expiry, and the Chrome profile as the de facto
credential store.

## Decision

1. **Interactive sign-in stays headed.** SWITCH edu-ID needs a real window and the
   user's own MFA. Nothing changes there.
2. **On success, the login command hands off and returns.** It exports the
   in-memory cookie jar, closes the headed context, writes a transient seed file
   (mode 0600, unlinked by the holder before Chrome launches), and spawns a
   detached **session holder** (`adam-mcp session-holder <seed>`).
3. **The holder owns a headless Chrome** with the persistent profile and the
   existing loopback ephemeral CDP arguments. It injects cookies, verifies the
   dashboard, writes `session-holder.json` (`pid`, `startedAt`, `verifiedAt`,
   `origin`), and stays alive until SIGTERM/SIGINT or context close. Stale records
   (dead PID) are cleaned up on read.
4. **The MCP server and browser provider attach over CDP** (`tryAttachCdp`, as
   before) and never launch a browser outside an explicit login. Reads without a
   session fail closed with `unauthorized` and a "run `adam-mcp login`" message;
   `adam_session_status` returns `reason: "login-required"` without launching.
5. **Lifecycle commands.** `adam-mcp status` reports logged-in reason, holder PID,
   and `checkedAt` without opening a window; `adam-mcp logout` stops the holder
   (`--purge` also removes the Chrome profile). `ADAM_BROWSER_HEADED=1` is a debug
   escape hatch that keeps the headed session in-process instead of handing off.
6. **RAM-only cookies remain.** Rebooting or a SWITCH timeout requires
   `adam-mcp login` again; re-login is the privacy trade, not a regression.

## Consequences

- The browser window closes after login; the login command no longer blocks a
  terminal; server restarts are free while the holder process lives.
- The project now owns holder lifecycle code (PID liveness, stale records, crash
  cleanup, logout). Holder failure fails closed with an actionable error.
- No new secret persistence: cookies remain in Chrome's process memory and the
  Chrome profile that already existed on disk; the seed file is transient.
- Machine reboot or session expiry still requires an interactive login.
