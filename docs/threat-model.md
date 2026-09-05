# Threat model

Version 2026-09-05. Independent trust review plus live ADAM checks. Not legal advice.

## Assets

SWITCH credentials and MFA, Chrome profile cookies, course pages and PDFs, dashboard personal data, exam/test objects, the published npm binary.

## Trust boundaries

Student laptop (Chrome profile → Playwright → MCP stdio → host) → model provider. ADAM remains the authorization source. The model and retrieved ADAM text are untrusted.

## Threats treated as P0

| ID | Threat | Control |
| --- | --- | --- |
| T1 | Confused deputy: model uses the student’s ADAM session | Read-only tools, confirm on page bodies, deny `tst`, no generic fetch |
| T2 | Prompt injection in pages/PDFs/filenames | Untrusted envelope; retrieved text cannot change authz or target `ref_id` |
| T3 | Local CDP session theft | No well-known debug port; attach only via profile `DevToolsActivePort` on 127.0.0.1 |
| T4 | Credential/cookie leak | No cookies in tools/logs; status omits `profileDir` |
| T5 | SSRF / navigation escape | HTTPS; allowlist on requested and final URL; origin pin |
| T6 | PDF bytes to a model | Metadata + URL by default; Chrome downloads cancelled; `adam_extract_file_text` returns bounded text + sha256 after `confirm: true`, never bytes |
| T7 | Stdout pollution | JSON-RPC on stdout; logs on stderr |
| T8 | Writes / CSRF | No write tools; no form submit except visible SWITCH login click |
| T9 | Third-country copy of course content | README discloses that tool results go to the configured model; minimize; no index |
| T10 | Supply chain | Lockfile, CI, audit, no live profile in publish environment |
| T11 | Academic integrity | Deny tests; no submit; no “does your homework” productization |
| T12 | Hosted token passthrough | No HTTP MCP in v1 |

## Residual risk

Prompt injection is not solved if page text is sent to a model. Local malware can read the Chrome profile. University policy can still prohibit the class of tools. State these in the README.
