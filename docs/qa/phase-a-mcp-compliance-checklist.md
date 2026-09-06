# Phase A MCP compliance checklist (canonical)

**Owner:** MCP Architect (advise) · **Orchestrator:** Leonidas  
**Audience:** QA Lead fixture gates  
**Updated:** 2026-09-06  
**SoT:** this file + adam-mcp eng posts (do not re-derive from sibling transcripts)

## Baseline (fixture gates) — B1–B12

| ID | Criterion | Pass | Fail |
| --- | --- | --- | --- |
| B1 | Stdio only; no Streamable HTTP listener | `serveStdio` works; no hosted HTTP | HTTP MCP without ADR |
| B2 | Tools + resources + prompts advertised | `tools/list`, resources (+ templates), `prompts/list` non-empty | Missing primitive class |
| B3 | Tool I/O schemas + annotations | Zod in/out; `readOnlyHint` on reads | Missing schema / wrong hints |
| B4 | Sensitive reads need `confirm: true` | `adam_read_page` / `adam_extract_file_text` reject without literal `true` | Succeeds without confirm |
| B5 | No file bytes to model | Text + sha256 only | Bytes/base64 in result |
| B6 | Untrusted notice on page/extract | `untrusted: true` + notice | Missing notice |
| B7 | Stdout hygiene | stdout = JSON-RPC; logs on stderr | Log noise on stdout |
| B8 | Resource URI ≠ live ADAM URL | Cite `https://adam.unibas.ch/go/…`; handles `adam://…` | Host told to fetch `adam://` in browser |
| B9 | Session tools only with browser provider | Fixture: no login tools; `--browser`: login + status | Login on fixture / cookies in results |
| B10 | `tst` denied | Test objects fail closed | Exam/test content returned |
| B11 | No deprecated primitives | No Sampling, Roots, MCP Logging client API; stderr/OTel only | New Roots/Sampling/Logging or HTTP+SSE |
| B12 | No MCP OAuth on stdio | Chrome session / env only | OAuth on local stdio |

## Phase A backlog gates

| ID | Criterion | Pass | Fail |
| --- | --- | --- | --- |
| A1 | Resource links in tool results | Results include `adam://…` + canonical HTTPS | Only HTTPS or bare refIds |
| A2 | Progress on long walks | Progress on search / calendar / extract | Silent multi-second hangs |
| A3 | Docs: confirm vs elicitation | Docs state `confirm:true` = interim schema gate after student asked to read; real confirms/future writes → MCP elicitation when host supports MRTR; not OS permission; not equated to tool annotations alone | Docs imply OS permission or equate confirm/annotations to elicitation |
| A4 | Pin SDK/protocol | `docs/architecture.md` pins `@modelcontextprotocol/server` 2.x + protocol era; packages/mcp dep matches ^2.0.0 | Undocumented / mismatched |
| A6 | Resources for read-by-id (design principle w/ A1) | New read-by-id → resources; tools = list/search/session/confirm-gated extracts | Duplicate get-by-id tools without resource path |

## Deferred

| ID | Notes |
| --- | --- |
| A5 completions | Phase B P1 after A1–A4; not a harden-reads ship blocker |

## Non-goals

Streamable HTTP only as uni-operated gateway with OAuth RS + audience binding; **no token passthrough**.

## Citations

- Repo: `packages/mcp/src/server.ts`, `results.ts`, `index.ts`, `docs/architecture.md`, `docs/scope.md`
- MCP 2026-07-28: server concepts, architecture, tools, deprecated, authorization, completion, security best practices
- Leonidas brief: `/workspace/research/mcp-adam-architecture-brief.md`
