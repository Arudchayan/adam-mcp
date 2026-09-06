# Architecture

```
AI client (Cursor, Claude Desktop, VS Code, Windsurf, Claude Code)
        │  stdio, JSON-RPC
        ▼
   packages/mcp          tools / resources / prompts
        │
        ▼
   packages/core         ref_id, /go/{type}/{id} URLs, errors
        │
        ├── fixture      synthetic catalog (default)
        └── browser      dedicated Chrome profile → https://adam.unibas.ch
```

ADAM MCP uses a local Chrome session for ADAM authentication. The MCP process talks to that browser; it is not a hosted ADAM proxy.

SOAP and HTML packages exist in the tree and fail closed. ADAM’s `/soap/server.php` returned 403 when checked (see [docs/providers.md](providers.md)).

Canonical citations are `https://adam.unibas.ch/go/{type}/{ref_id}`. MCP resource URIs (`adam://crs/{refId}`, …) are handles for the host, not URLs the browser should fetch.

Stdout is MCP only. Logs go to stderr.

## SDK / protocol pin (A4)

- **SDK:** `@modelcontextprotocol/server` **2.x** — `packages/mcp` depends on `^2.0.0` (resolved 2.0.0 in lockfile).
- **Protocol era:** MCP specification **2025-03-26** / **2026-07-28** family (stdio JSON-RPC; tools, resources, prompts). Do not adopt deprecated Sampling, Roots, or protocol Logging; do not put MCP OAuth on stdio.

Bump the pin in this file when changing the server dependency major or the negotiated protocol era.

## Confirm vs elicitation (A3)

`confirm: true` on `adam_read_page` and `adam_extract_file_text` is an **interim schema gate** used **after the student asked to read** that object: a required tool argument so hosts can surface the flag in the tool UI. It is **not**:

- an OS permission dialog,
- MCP **elicitation**, or
- equated to tool annotations alone (`readOnlyHint`, etc.).

Real confirms and future writes → MCP **elicitation** when the host supports MRTR. Until then, keep the schema gate; do not document `confirm` or annotations as elicitation.

