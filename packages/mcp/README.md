# adam-mcp

MCP server for University of Basel ADAM.

The release candidate is version `0.2.0`. npm installation is pending publication and verification. The CLI bundles the project's workspace code; npm installs its declared runtime dependencies.

You need Node.js 22+ and Google Chrome. Use a supported Node.js LTS release. After publication:

```bash
npm install -g adam-mcp@0.2.0
```

Then:

```bash
adam-mcp login   # Sign in through Chrome; credentials stay in the browser
adam-mcp status  # Verify the local session
adam-mcp        # Start the stdio server through your MCP client
```

For guided setup: `adam-mcp setup --client codex --write --login`. Choose `codex`,
`cursor`, `claude-desktop`, `windsurf`, or `vscode`. Setup previews by default;
`--write` backs up and merges existing configuration, and `--login` verifies the
course listing. `adam-mcp doctor --client codex` checks prerequisites and passive
session state without launching Chrome. Restart your client and enable **adam**.

Run `adam-mcp logout` to stop the local session. `--browser` is optional.

Page text, file text, exercise instructions, and forum posts require approval for
the selected object. Clients with elicitation support can request approval;
other clients use `confirm: true`. Summaries and metadata remain read-only.
Exams, grades, submissions, and other writes are unsupported. Scanned PDFs require
opening the file in ADAM; OCR is not provided.

For client configuration and the currently verified clone/setup path, see the
[project README](https://github.com/Arudchayan/adam-mcp/blob/main/README.md) and
[setup guide](https://github.com/Arudchayan/adam-mcp/blob/main/docs/setup.md).
This unofficial community server is read-only. Tool output follows your client's
model provider; it never returns file bytes. See the
[limitations and privacy notes](https://github.com/Arudchayan/adam-mcp/blob/main/README.md#limitations).

Client configuration support and walkthrough evidence are recorded in the
[compatibility matrix](https://github.com/Arudchayan/adam-mcp/blob/main/docs/client-compatibility.md).
Maintainers: see the [release guide](https://github.com/Arudchayan/adam-mcp/blob/main/docs/releasing.md).

License: GPL-3.0-or-later.
