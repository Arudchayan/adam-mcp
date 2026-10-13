# adam-mcp

MCP server for University of Basel ADAM.

Once `adam-mcp@0.2.0` is published, install with `npx -y adam-mcp` or `npm install -g adam-mcp`. The pack is self-contained (`dist/adam-mcp.mjs` bundles workspace packages).

You need Node.js 20+ and Google Chrome. After installing the package:

```bash
adam-mcp login   # Sign in through Chrome; credentials stay in the browser
adam-mcp status  # Verify the local session
adam-mcp        # Start the stdio server through your MCP client
```

Run `adam-mcp logout` to stop the local session. `--browser` is optional.

For client configuration and the currently verified clone/setup path, see the
[project README](https://github.com/Arudchayan/adam-mcp/blob/main/README.md) and
[setup guide](https://github.com/Arudchayan/adam-mcp/blob/main/docs/setup.md).
This unofficial community server is read-only. Tool output follows your client's
model provider; it never returns file bytes. See the
[limitations and privacy notes](https://github.com/Arudchayan/adam-mcp/blob/main/README.md#limitations).

License: GPL-3.0-or-later.
