# Project identification and improvement analysis

Date: 21 October 2026. Inspected source: `a799028`.

## Scope and result

This is a local, read-only ADAM connector for MCP clients, implemented as a
TypeScript npm workspace. Chrome is the live transport and authentication boundary;
stdio is the client transport. It is already a substantial, tested connector, not
an early scaffold. The best next investment is predictable discovery and bounded
resource use, followed by features built on existing metadata.

This analysis inspected source, tests, architecture, roadmap, scope, client evidence
and CI. It ran local synthetic verification. It did not access live ADAM, verify
registry state externally, or measure live network latency. Findings about current
release status below compare repository records only. Runtime behavior was not changed.

## Project map

| Component | Responsibility |
| --- | --- |
| `packages/core` | Provider contracts, object policy, canonical URLs, redaction, search/date helpers, text/PDF extraction |
| `packages/mcp` | 14 tools, resources, three study prompts, approval gates, structured results, setup and diagnostics |
| `packages/provider-browser` | Dedicated Chrome session, navigation, markup parsing, enrolled-tree discovery, caches, pagination, login/recovery |
| `packages/provider-fixture` | Synthetic in-process catalog and test workflows |
| `packages/provider-html`, `packages/provider-soap` | Intentionally inactive, fail-closed providers |
| `scripts`, `.github/workflows` | Build, package verification, release checks, synthetic benchmark and cross-platform CI |

The packages/scripts inventory contains 70 non-test `.ts`/`.mjs` files and 50
`.test.ts`/`.test.mjs` files. File counts describe structure, not quality.

## Verified baseline

| Check | Local outcome |
| --- | --- |
| `npm test` | Passed across all workspaces; exit 0 |
| `npm run typecheck` | Passed across all workspaces |
| `npm run build` | Passed |
| `npm run test:dist` | Passed legacy/modern stdio and page-aware PDF worker checks outside the repository |
| `npm run benchmark:reads` | Passed; synthetic result below |

Environment: Windows, Node `v24.19.0`. Dependency audit, clean tarball installation,
release checks, and actual desktop-client walkthroughs were not rerun in this analysis.

The benchmark uses 100 file links and approximately 50,000 text characters. It
measures 50 warm batches of four provider calls, after warmup:

- Cold four-call batch: **21.889 ms**.
- Warm four-call batch: **0.444 ms median**, **0.933 ms p95**.
- Across the measured 200 calls: **zero extra navigations**, **zero HTML accesses**.
- Total navigations including the cold call: **one**.

These are one-run, in-memory timings. They demonstrate effective navigation and
catalog reuse; they do not establish live ADAM responsiveness or end-to-end MCP cost.

## Efficiency findings

| Priority | Finding and evidence | Proposed improvement | Validation |
| --- | --- | --- | --- |
| P1 | PDF extraction serializes workers, but `waiting` has no admission cap or queue deadline. Waiting closures retain input buffers. The 20-second parser deadline starts only when a worker starts. [Source](../../packages/core/src/pdf-extract.ts#L10) | Bound queued extraction count and preferably retained bytes; impose a cancellable wait deadline and return a structured overload error. Keep parser isolation. | Saturation refuses excess work; queued cancellation frees retained work; waiting expires; subsequent requests recover. |
| P1 | Complete global walks share an operation and a 60-second memo. Course-scoped discovery bypasses both and starts a walk each time. Page navigation/parsing can still be shared, so this is repeated traversal/progress work, not proof of duplicate network requests. [Source](../../packages/provider-browser/src/browser-provider.ts#L707) | Key complete-walk memos and shared operations by scope and session generation. Bound scope entries; retain enrollment checks, TTL, independent cancellation and refresh semantics. | Concurrent search/news/calendar for one course share a walk; different courses stay isolated; cancellation and refresh cannot leak stale results. Benchmark benefit before claiming a speedup. |
| P1 | Discovery stops at 48 retained pages or 120 seconds. Partial walks are correctly not memoized; retrying discovery starts traversal again and may encounter the same cap. Page caches help, but do not provide traversal continuation. [Source](../../packages/provider-browser/src/browser-provider.ts#L762) | First add synthetic wide/deep-course benchmarks and coverage metrics. Then consider bounded traversal continuation or fair per-course scheduling. Distinguish discovery continuation from existing result-pagination cursors. | A large fixture makes forward progress across calls, never labels partial coverage complete, and preserves session/scope isolation. |
| P2 | `readSnapshot` makes separate browser calls for HTML, text, title and links, then repeats collection for same-origin frames. HTML/text caps are applied after the full corresponding strings arrive in Node. Links are collected without an explicit count cap at this layer. [Source](../../packages/provider-browser/src/playwright-session.ts#L681) | Profile browser round trips and peak payload sizes. Evaluate bounded browser-side collection and fewer DOM evaluations, preserving frame handling and parser evidence. | Compare cold p50/p95, bytes and memory on synthetic large pages; replay listing/forum/session fixtures. Latency gain is currently a hypothesis. |
| P2 | Tool telemetry records total duration and outcome; the benchmark covers only warm provider reads. It cannot attribute cold latency to queueing, navigation, collection, parsing or serialization. [Source](../../packages/mcp/src/telemetry.ts#L7) | Add content-free stage timings, cache-hit counters, pages visited and cap reasons; benchmark cold discovery, scoped concurrency, large trees, queue pressure and extraction. | Logs contain no course text, titles, credentials or sensitive URLs; results include reproducible workload definitions. |
| P3 | CI builds explicitly, then `test:package` builds again. `release:check` also calls a build through `check`, then again through `test:package`. [Scripts](../../package.json#L27), [CI](../../.github/workflows/ci.yml#L27) | Preserve a self-contained package-check command, but let CI verify the artifact it has just built without rebuilding. Measure savings before prioritizing. | Packaging still exercises the actual built artifact; local standalone verification still builds when needed. |

Do not increase browser concurrency as the first optimization. The shared page and
session lifecycle intentionally serialize browser operations; concurrency would
require a separate design and evidence that it improves the real bottleneck.

## Feature opportunities

| Order | Feature | Student value | Boundaries and dependencies |
| --- | --- | --- | --- |
| 1 | Metadata inventory changes | Answer which materials appeared, disappeared or changed between observations. `what_changed` currently reports timestamped news only. [Prompt](../../packages/mcp/src/server.ts#L759) | Opt-in local metadata snapshots, explicit retention/reset, course/session isolation. Compare only matching scopes and coverage; incomplete scans must not assert deletion. Metadata changes do not prove file bytes changed. No PDF corpus. New tool requires ADR. |
| 2 | Search filters and clearer ranking | Find a file/exercise/forum more directly using type and available breadcrumb context; tolerate case/diacritics and multiple terms if specified. | Extend the existing tool where practical. Filter before result pagination, bind filters to cursor identity, keep fixture/browser parity. Do not silently turn this into full-document indexing. Measure precision with a labelled synthetic query set. |
| 3 | Course inventory with coverage | Show a recursive material outline with visited/skipped containers and explicit continuation rather than requiring many manual child-list calls. | Reuse existing walk machinery and canonical links. Traversal must remain bounded and avoid files' bytes, denied types and unknown surfaces. New recursive API/tool needs ADR and coverage semantics. |
| 4 | Deadline agenda/export | Produce a chronological agenda or local calendar export from existing deadline evidence. | Define date-only versus timed events, timezone semantics, stable event IDs and inferred-date labelling. Export must not invent midnight deadlines or write to ADAM. |
| 5 | Broader verified client support | Make setup and approval behavior dependable in Cursor, Claude Desktop, VS Code and other documented clients. | Run actual version/OS walkthroughs. Generated configuration tests alone are insufficient; the existing matrix explicitly records pending walkthroughs. [Evidence](../client-compatibility.md) |

OCR is a later, selected-document feature: it adds dependencies and resource costs,
changes extraction behavior, and needs an ADR and the existing object-specific
approval. Additional ADAM object types remain inventory-gated by the roadmap.
SOAP/HTML activation, ADAM writes, exam access and mass-document indexing are not
recommended within this improvement scope.

## Documentation and maintenance findings

- [ROADMAP.md](../ROADMAP.md#L38) says npm publication is not done, while README and
  the [publication record](2026-10-21-npm-publication.md) record publication and
  installed-client verification. [scope.md](../scope.md#L27) also retains
  pre-publication wording. Reconcile current product guidance with the dated record.
- [Production readiness](../qa/production-readiness.md) describes the historical
  Node 20/22 matrix. Current CI targets Node 22/24. Keep historical evidence dated
  and make the currently supported matrix easy to identify.
- The browser provider combines discovery, caching, object reads, extraction
  orchestration and metadata recovery. Extracting a scope-aware walk coordinator
  is a reasonable seam while implementing keyed walk reuse. A broad rewrite is
  not justified by the passing baseline or measured warm-path performance.

## Recommended implementation sequence

1. Reconcile current docs and add representative cold/discovery measurements.
2. Bound PDF queue admission, retained input and waiting time.
3. Add scope-keyed shared walks with cancellation/refresh regressions.
4. Design metadata change tracking with coverage-aware comparison in an ADR,
   then implement a synthetic fixture slice.
5. Improve search and discovery continuation using measured student workflows.

For each runtime change, run the affected regressions, workspace typecheck, build
and distribution smoke tests. Use full package/release checks when packaging or
runtime dependency boundaries change. Session/extraction changes and new tools
must follow the repository's ADR requirement. Preserve object-specific body
approval, origin pinning, exam denial, stdout hygiene and the no-write boundary.
