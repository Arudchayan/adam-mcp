# Phase A fixture-first test plan (adam-mcp)

**Status:** outline for coordinated docs/test PR
**Repo:** https://github.com/Arudchayan/adam-mcp
**Contract:** MCP Architect Phase A (B1-B12 baseline; A1-A4 + A6 backlog; A5 deferred Phase B P1)
**Owner:** QA Lead
**Date:** 2026-09-06
**Checklist SoT:** docs/qa/phase-a-mcp-compliance-checklist.md

## Principles

1. **Fixture-first.** Default harness uses ADAM_PROVIDER=fixture (createFixtureProvider / spawn packages/mcp/src/index.ts). No live ADAM, SWITCH edu-ID, or Chrome session for Phase A gates.
2. **Clear pass/fail.** Every checklist ID maps to an executable case with binary PASS/FAIL criteria (see checklist SoT).
3. **Extend existing suites** — do not rewrite:
   - packages/mcp/src/stdio.test.ts
   - packages/mcp/src/server.test.ts
   - packages/mcp/src/providers.test.ts
   - packages/provider-fixture/src/fixture-provider.test.ts
4. **No live ADAM for Phase A gates.** Live browser only if a future case truly needs a real session; not required for B1-B12 or A1-A4/A6.

## Release gate

| Gate | Requirement |
| --- | --- |
| Main / harden-reads | All **B1-B12** green under fixture |
| Phase A PR landings | **A1-A4 + A6** green when those feature PRs merge |
| Deferred | **A5** completions -> Phase B P1 (not a ship blocker) |

## Harness

- **Commands:** npm test at workspace root and package dirs; prefer targeted suite files.
- Extend suites: packages/mcp/src/stdio.test.ts, packages/mcp/src/server.test.ts, packages/mcp/src/providers.test.ts, packages/provider-fixture/src/fixture-provider.test.ts.
- **RPC pattern:** spawn stdio MCP server under fixture provider; drive JSON-RPC (initialize, tools/list, resources/list, prompts/list, tools/call, resources/read) and assert structured results plus stderr hygiene.
- **Golden fixture IDs:**
  | ID | Role |
  | --- | --- |
  | 100001 | Primary course / happy-path tree |
  | 100011 | File PDF (extract without bytes) |
  | 100021 | Exercise (exc) with deadline — not a folder |
  | 100020 | Empty Exercises fold — keep; empty folder != no deadlines |
  | 100030 | Golden **tst** (B10) — deny/fail-closed; never returned to model |

## Baseline B1-B12

| ID | Case | PASS | FAIL | Coverage today | First PR action |
| --- | --- | --- | --- | --- | --- |
| B1 | Stdio only; no Streamable HTTP listener | serveStdio works; no hosted HTTP | HTTP MCP without ADR | Covered in stdio/server suites | Assert no HTTP listener in spawn tests |
| B2 | Tools + resources + prompts advertised | tools/list, resources (+ templates), prompts/list non-empty | Missing primitive class | Partial — extend list assertions | Add full three-primitive list smoke |
| B3 | Tool I/O schemas + annotations | Zod in/out; readOnlyHint on reads | Missing schema / wrong hints | Partial | Assert annotations on read tools |
| B4 | Sensitive reads need confirm: true | adam_read_page / adam_extract_file_text reject without literal true | Succeeds without confirm | Covered — stdio RPC reject omit/false + success with confirm:true; ConfirmGate in handlers | Keep RPC + schema regression |
| B5 | No file bytes to model | Text + sha256 only | Bytes/base64 in result | Covered | Keep regression on extract result shape |
| B6 | Untrusted notice on page/extract | untrusted: true + notice string | Missing notice | Covered — stdio + server fixture asserts | Assert untrusted + notice on page/extract tools |
| B7 | Stdout hygiene | stdout = JSON-RPC only; logs on stderr | Log noise on stdout | Covered in stdio tests | Keep spawn hygiene asserts |
| B8 | Resource URI != live ADAM URL | Cite https://adam.unibas.ch/go/...; handles adam://... | Host told to fetch adam:// in browser | Partial | Assert citation shape + handle form |
| B9 | Session tools only with browser provider | Fixture: no login tools; --browser: login + status | Login on fixture / cookies in results | Partial | Fixture asserts no session/login tools |
| B10 | tst denied | Test objects fail closed | Exam/test content returned | Covered — fixture catalog + stdio/server/provider asserts | Add golden tst object; assert deny/fail-closed |
| B11 | No deprecated primitives | No Sampling, Roots, MCP Logging client API; stderr/OTel only | New Roots/Sampling/Logging or HTTP+SSE | Covered — stdio initialize caps + server.getCapabilities + no HTTP listener in spawn | Keep negative asserts |
| B12 | No MCP OAuth on stdio | Chrome session / env only | OAuth on local stdio | Covered — tools/list + wiring source asserts under fixture | Keep no-oauth asserts |

**Known coverage gaps (must close for main gate):** none for baseline (B11/B12 closed PR #7 / `21728f3`). A1/A2/A6 covered in this PR.

## Phase A backlog (A1-A4 + A6)

| ID | Case | PASS | FAIL | Notes / first test action |
| --- | --- | --- | --- | --- |
| A1 | Resource links in tool results | Results include adam://... + canonical HTTPS | Only HTTPS or bare refIds | Covered — tool-result shape asserts (resourceUri + HTTPS + resource_link) |
| A2 | Progress on long walks | Progress notifications on search / calendar / extract | Silent multi-second hangs | Covered — LongWalkStub + stdio progress observer |
| A3 | Docs: confirm vs elicitation | Docs state confirm = interim schema gate; real confirms / future writes -> elicitation when host supports MRTR | Docs imply OS permission or equate confirm/annotations to elicitation | Doc/lint or snapshot check in docs PR |
| A4 | Pin SDK/protocol | docs/architecture.md pins MCP server 2.x + protocol era | Undocumented / mismatched | Assert pin present in docs; optional package version smoke |
| A6 | Resources for read-by-id | New read-by-id -> resources; tools = list/search/session/confirm-gated extracts | Duplicate get-by-id tools without resource path | Covered — resources/read + frozen adam_get_* surface (tied to A1) |

### Deferred

| ID | Notes |
| --- | --- |
| A5 | Completions — Phase B P1 after A1-A4; **not** a harden-reads / Phase A ship blocker |

### Non-goals (Phase A)

- Streamable HTTP MCP (unless separate uni-operated gateway ADR)
- MCP OAuth on local stdio
- Writes (submit, post, mail send)
- Replacing Chrome session as production access path
- Live ADAM as a CI gate

## Fixture strategy

- **Provider:** ADAM_PROVIDER=fixture only for Phase A gates.
- **Golden IDs:** 100001 (course), 100011 (file/PDF), 100021 (exc with deadline), 100020 (empty Exercises fold), 100030 (tst deny / B10).
- **100020 vs 100021 (ADAM Domain note):** Fixture SoT: 100020 = empty Exercises fold; 100021 = exercise (exc) with deadline (also on calendar). Never treat empty 100020 as no-deadlines. Phase A: assert list-empty for 100020 and getExercise for 100021; do not delete either ID.
- **Deny objects:** exam/test (tst) must be present and fail closed (B10).
- **No cookies / no login tools** under fixture (B9).
- **Extend** existing fixture-provider and MCP server tests rather than standing up a parallel harness.

## First code PRs (after architecture audit)

Still **fixture only** — no live ADAM in these PRs.

1. **B6** — untrusted notice on page/extract (untrusted: true + notice) — closed by fixture asserts on tool paths
2. **B10** — tst deny / fail-closed golden — closed by fixture golden 100030 + deny asserts
3. **B4** — RPC confirm: true reject + success paths (closed PR #6 / `5982bdd`)
4. **B11 / B12** — no deprecated primitives; no MCP OAuth on stdio (PR #7 / `21728f3`)
5. **A1 / A2 / A6** — resource links, progress, read-by-id (this PR)
6. Then **A3 / A4** (confirm≠elicitation docs + SDK pin)

Order rationale: close main-gate baseline gaps before backlog; B6/B10/B4 are highest user-safety / compliance risk; B11/B12 lock protocol surface; A-series rides feature PRs.

## Coverage gap checkboxes

Track until green on main under fixture:

- [x] **B6** — untrusted notice on page/extract
- [x] **B10** — tst denied / fail-closed
- [x] **B4** — sensitive reads RPC require confirm: true
- [x] **B11** — no deprecated primitives (Sampling / Roots / MCP Logging client API)
- [x] **B12** — no MCP OAuth on stdio
- [x] **A1** — resource links in tool results (`adam://` + HTTPS)
- [x] **A2** — progress on long walks (search / calendar / extract)
- [x] **A6** — resources for read-by-id (no duplicate get-by-id tools)

When baseline B1-B12 and landed A1-A4+A6 cases are green, Phase A fixture gate is satisfied per checklist SoT. **Next:** A3 / A4.
