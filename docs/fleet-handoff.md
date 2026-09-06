# Fleet handoff — 2026-09-06

**Purpose:** Continuity if Grok Bot usage dies. Prefer **AGENTS.md** + **docs/** over this file or chat history.

## Active agents (do not recreate retired)

| Role | Agent ID | Notes |
| --- | --- | --- |
| Leonidas (orchestrator) | `abcd9db3-597a-4044-9c35-e41c7645f780` | Owns fleet / merge |
| MCP Architect | `798edcb6-192a-486a-b13d-133d0de9f8e7` | Protocol / MCP skim |
| ADAM Domain | `77190499-5ead-4fb6-b98e-5297ed8a9873` | Fixture semantics / live inventory |
| QA Lead | `fa7159f2-06ea-4e78-9185-f5a31d697ced` | Fixtures + security skim; routines **09:00 / 09:15** Europe/Berlin |
| Lingxi | `4d0d1134-36cf-40f2-969c-f0fd1ab83eec` | PR pipeline |

**Retired — do not recreate:** Researchy, Security, OSS/DX, Projects Manager.

## SoT rules

- **Sources of truth:** eng memory + project memory + `/workspace/adam-mcp-research/` + **in-repo `docs/`** (esp. `docs/qa/`, `docs/scope.md`, ADRs).
- **Ban:** grepping agent transcripts for durable policy or gates.
- Prefer committed docs / AGENTS.md; this handoff is continuity only.

## Status (2026-09-06)

- **Merged:** PR1 docs, PR2 **B6** (untrusted notice).
- **Next Phase A order:** **B10 → B4 → B11/B12** (fixture-first; see `docs/qa/`).
- Lean review: QA Lead → MCP Architect → Domain only if semantics change → Lingxi/Leonidas merge.

## Eng group

- **Group ID:** `2a035929-3c85-4322-a610-8ee697252c53`
- **Max members:** 6
- **Rebuild:** keep active five above; **exclude** retired (Researchy, Security, OSS/DX, Projects Manager). No dead members.

## Paste-prompt (new Grok Bot chat)

```
You are continuing ADAM MCP (Uni Basel) fleet work. SoT = AGENTS.md + in-repo docs/ + /workspace/adam-mcp-research/ + eng/project memory. Do NOT grep transcripts.

Active agents only:
- Leonidas abcd9db3-597a-4044-9c35-e41c7645f780 (orchestrator)
- MCP Architect 798edcb6-192a-486a-b13d-133d0de9f8e7
- ADAM Domain 77190499-5ead-4fb6-b98e-5297ed8a9873
- QA Lead fa7159f2-06ea-4e78-9185-f5a31d697ced (fixtures + security skim; 09:00/09:15)
- Lingxi 4d0d1134-36cf-40f2-969c-f0fd1ab83eec (PR pipeline)
Retired (do not recreate): Researchy, Security, OSS/DX, Projects Manager.

Eng group 2a035929-3c85-4322-a610-8ee697252c53 max 6 — rebuild without dead members.

Status 2026-09-06: PR1 docs + PR2 B6 merged. Next: B10 → B4 → B11/B12 (fixture-first). Read AGENTS.md + docs/qa/ before acting.
```
