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
