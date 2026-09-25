# ADR 0017 - Live browser is the only runtime

## Context

The CLI defaulted to `ADAM_PROVIDER=fixture`, a synthetic catalog of courses,
files, and deadlines. `npm start` and host JSON from `npm run setup` therefore
served invented ADAM objects unless the student remembered `--browser`. A dead
session holder (reboot, crashed Chrome) then failed every live read with
`unauthorized` even when the Chrome profile from the last successful login was
still on disk. ADR 0009 forbade launching Chrome outside explicit login, which
made that miss terminal for the MCP process.

## Decision

1. **Runtime is live ADAM.** Unset `ADAM_PROVIDER` and `--browser` both select
   the browser provider. `--browser` remains a no-op alias so existing host JSON
   keeps working.
2. **`ADAM_PROVIDER=fixture` fail-closes** (`provider_unavailable`,
   `retryable=false`). The synthetic catalog is not a student path. In-process
   tests may still call `createConfiguredProvider("fixture")`. Stdio contract
   tests spawn the CLI with `ADAM_MCP_TEST_FIXTURE=1` only (not documented in
   help, `.env.example`, or `npm run setup`).
3. **Dead-holder resume.** When a tool needs a page, no holder is running, and
   CDP is not attached, the MCP process may launch **headless** Chrome on the
   existing profile (no window, no seed file, no password). It verifies the
   dashboard the same way the holder does. If signed in, it exports the cookie
   jar, closes that Chrome, and starts a new session holder (ADR 0009 handoff).
   If the page is the login screen, it closes Chrome and returns the existing
   `unauthorized` / `login-required` text. It does not resume when a holder is
   already running. `adam_session_status` still does not launch a browser.
4. **First sign-in stays headed `adam-mcp login`.** Resume does not invent
   listings when a live page is empty or unknown.

## Consequences

- A clone that starts the server without login sees `unauthorized` / session
  tools, not a synthetic seminar.
- Reboot or a killed holder can recover from the on-disk profile when SWITCH
  cookies are still valid; otherwise the student runs `npm run login` again.
- CI stays fixture-based via in-process providers and the stdio test harness.
