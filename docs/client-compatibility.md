# Client compatibility

Updated 21 October 2026. Repository fixture/wire checks establish server behavior;
they do not establish a successful walkthrough in each real client.

| Client | Local configuration | Evidence | Login and timeouts |
| --- | --- | --- | --- |
| Codex CLI | TOML `mcp_servers.adam` | Windows, CLI 0.163.0-alpha.11: exact installed release tarball verified for sign-in/recovery, listing, selected approved read, refusal, host timeout, restart and logout. Graphical approval/progress UI remains unverified. | Generated 2,100-second tool timeout; CLI login fallback; deliberately shortened host timeout observed |
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

The Node 22/24 Windows/macOS/Linux matrix and release-candidate workflow passed
for npm source `09ebda4`. Detailed client outcomes, review scope, artifact identity
and UI/expiry limits are retained in the
[publication record](audit/2026-10-21-npm-publication.md). Earlier dated reviews
record preparation states and are historical evidence.
