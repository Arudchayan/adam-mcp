# ADR 0044: Close the configured provider when stdio ends

## Status

Accepted

## Context

The stdio SDK closes its MCP connection when client stdin reaches EOF, but its `serveStdio` handle returns immediately and does not own the configured provider. The CLI previously closed that provider only on SIGINT/SIGTERM, leaving provider-owned browser resources alive after a normal client disconnect.

## Decision

The stdio entrypoint treats stdin EOF and termination signals as one idempotent shutdown path: close the SDK connection, then close the configured provider. It does not log out or stop the separately owned headless session holder. Signal shutdown retains the existing process-exit behavior; EOF lets the process exit naturally after cleanup.

## Consequences

Normal MCP client disconnects release provider-owned resources. Synthetic lifecycle tests verify EOF cleanup and single invocation without launching Chrome or accessing ADAM. Protocol behavior and tool registration are unchanged.
