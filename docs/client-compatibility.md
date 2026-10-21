# Client compatibility

Updated 21 October 2026. Repository fixture/wire checks establish server behavior;
they do not establish a successful walkthrough in each real client.

| Client | Local configuration | Evidence | Login and timeouts |
| --- | --- | --- | --- |
| Codex CLI | TOML `mcp_servers.adam` | Windows, CLI 0.163.0-alpha.10.2: live metadata and selected approved read through built distribution verified; final installed-artifact and recovery checks pending. See dated review below. | Generated 2,100-second tool timeout; CLI login fallback |
| Codex desktop / IDE and compatible ChatGPT desktop surface | TOML `mcp_servers.adam` | Generated configuration tested; separate UI walkthrough pending. | Verify host behavior; CLI login fallback |
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

The Node 22/24 Windows/macOS/Linux matrix passed for `43a4243`. Final review fixes
and the refreshed dependency require a new exact-commit matrix. Detailed observed
client outcomes and remaining gates are in the
[21 October release review](audit/2026-10-21-release-review.md).
