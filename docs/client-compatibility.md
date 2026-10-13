# Client compatibility

Updated 13 October 2026. Repository fixture/wire checks establish server behavior;
they do not establish a successful walkthrough in each real client.

| Client | Local configuration | Evidence | Login and timeouts |
| --- | --- | --- | --- |
| Codex CLI / desktop / IDE, and compatible ChatGPT desktop surface | TOML `mcp_servers.adam` | Official local STDIO documentation; generated config and both wire modes tested. Actual version/OS walkthrough pending. | Generated 2,100-second tool timeout; CLI login fallback |
| Cursor | JSON `mcpServers.adam` | Configuration generation/merge tested; actual version/OS walkthrough pending | Verify client limits; prefer CLI login |
| Claude Desktop | JSON `mcpServers.adam` | Configuration generation/merge tested; actual version/OS walkthrough pending | Verify client limits; prefer CLI login |
| Windsurf | JSON `mcpServers.adam` | Configuration generation/merge tested; actual version/OS walkthrough pending | Verify client limits; prefer CLI login |
| VS Code Copilot | JSON `servers.adam`, type `stdio` | Configuration generation/merge tested; actual version/OS walkthrough pending | Verify client limits; prefer CLI login |
| Claude Code | Add the absolute Node executable and built entry with `claude mcp add` | Manual registration only; shell quoting and walkthrough pending | Prefer CLI login |
| Hosted web clients | No local configuration path | Outside this local-only server's supported deployment scope | No hosted listener or tunnel |

[Official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
describes local desktop/CLI/IDE configuration, timeout options and the distinction
from hosted web usage. Configuration format compatibility is not proof that a
particular installed client supports progress, elicitation or cancellation.

## Walkthrough to record before claiming a verified client

Record client version, OS and date; validate clean configuration, sign-in/MFA,
course listing, one requested body read, decline/cancel, session expiry, restart,
explicit logout, slow-read timeout and progress. Test the `confirm:true` fallback
and elicitation only when the client advertises it. Record outcomes rather than
private screenshots, cookies or course bodies.

CI passed on Windows/macOS/Linux with Node 20/22 for implementation commit
`6142af6`. Actual CI results for the final release head, packaging results, and
live client evidence belong in the [readiness record](qa/production-readiness.md).
