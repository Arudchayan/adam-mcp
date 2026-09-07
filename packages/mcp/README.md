# adam-mcp

MCP server for University of Basel ADAM.

Once published, install with `npx -y adam-mcp` or `npm install -g adam-mcp`. The pack is self-contained (`dist/adam-mcp.mjs` bundles workspace packages).

For host JSON snippets and Chrome login helpers, clone the repo and follow the root [README](../../README.md) / [docs/setup.md](../../docs/setup.md):

```bash
npm run setup
```

Default without `--browser` is a synthetic fixture catalog. `--browser` uses the local Chrome ADAM session.

License: GPL-3.0-or-later.
