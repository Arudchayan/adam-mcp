# Security skim checklist (QA Lead)

**Updated:** 2026-09-06 · **Owner:** QA Lead (Security specialist retired — light skim only; not deep privacy product ownership)

Use on docs and runtime PRs. Cross-check [SECURITY.md](../../SECURITY.md) and [docs/threat-model.md](../threat-model.md). Stay quiet when nothing new landed.

## When to run

- Architecture audit / Phase A gate lands
- Runtime fixture PRs (B10, B4, B11/B12, …)
- Docs that touch auth, session, extract, transport, or publish/tags

## PASS / FAIL (every PR skim)

| ID | Check | PASS | FAIL |
| --- | --- | --- | --- |
| S1 | Local-first / stdio | No new hosted MCP HTTP without ADR | Streamable HTTP or remote listener added casually |
| S2 | No MCP OAuth on stdio | Auth stays Chrome session / env | OAuth bolted onto stdio |
| S3 | Secrets / PII in diff | No cookies, profiles, SWITCH passwords, live course PDFs | Any of the above committed |
| S4 | Untrusted content | Page/extract keep `untrusted` + notice (B6) | Missing envelope on those tools |
| S5 | `tst` / EXAM | Exam/test bodies denied (B10) | Exam content returned |
| S6 | No file bytes to model | Extract = text/metadata only | Bytes/base64 in tool results |
| S7 | Writes | No write tools unless Phase C + elicitation ADR | Submit/post/mail tools without review |
| S8 | Publish/tags | Tags/npm only after SECURITY.md checklist green | Tag/npm without checklist |

## Residual (known, do not re-litigate every PR)

- Page text sent to a model can still contain injection (T2 residual).
- Local malware can read the Chrome profile.
- University policy may still prohibit this class of tool.

## Architecture-audit delta (when audit lands)

Produce a short eng note covering: stdio credentials via env/OS/Chrome-session (SWITCH edu-ID); local-first boundaries; no MCP OAuth on stdio; if remote HTTP is proposed — OAuth 2.1 RS, Origin checks, audience-bound tokens, no token passthrough. Point at threat-model IDs T1–T12.
