# Threat model

Student laptop: Chrome profile → Playwright → MCP stdio → host → model provider. ADAM remains the authorization source. Retrieved page/PDF text is untrusted.

| ID | Threat | Control |
| --- | --- | --- |
| T1 | Model uses the student’s ADAM session as a deputy | Read-only tools, interim `confirm: true` schema gate on page/extract bodies (auto-fillable until MCP elicitation), deny `tst`, no generic fetch |
| T2 | Prompt injection in pages/PDFs/filenames | Untrusted envelope on page/extract payloads; all other ADAM strings (titles, exercise instructions, news summaries) remain untrusted-but-unmarked — hosts must treat all ADAM output as untrusted; retrieved text cannot change authz |
| T3 | Local CDP session theft | No well-known debug port; attach via profile `DevToolsActivePort` on 127.0.0.1 |
| T4 | Cookie leak via tools/logs | Cookies omitted from tools and status; tool text and structured payloads redacted |
| T5 | SSRF / navigation escape | HTTPS; allowlist on requested and final URL; origin pin |
| T6 | PDF bytes to a model | Metadata + URL by default; `adam_extract_file_text` returns bounded text after `confirm: true` |
| T7 | Stdout pollution | JSON-RPC on stdout; logs on stderr |
| T8 | Writes / CSRF | No write tools |
| T9 | Course content copied to a model host | README states results follow the client’s model; no local RAG index |
| T10 | Supply chain | Lockfile, CI, audit; no live profile in publish |
| T11 | Academic integrity | Deny tests; no submit |
| T12 | Hosted token passthrough | No HTTP MCP in v1 |

Residual: page text sent to a model can still contain injection. Local malware can read the Chrome profile. University policy can still prohibit this class of tool.
