# ADAM Agent Access Research and Open-Source Project Brief

> Archived snapshot, 5 September 2026. Current docs: [README](../../README.md), [AGENTS.md](../../AGENTS.md). Visual checks: [2026-09-05-visual-validation.md](./2026-09-05-visual-validation.md).

**Research date:** 5 September 2026. ADAM was inspected read-only in an already authenticated Chrome session. A later unauthenticated visual pass the same day confirmed public catalog URLs, ILIAS 10.10 in the page footer, and HTTP 403 on `/soap/server.php`. See `docs/visual-validation-2026-09-05.md`. No passwords, tokens, files, messages, submissions, enrollments, or settings were changed.

## Executive recommendation

Build a small, open-source **ADAM/ILIAS adapter plus MCP facade**, with a provider-neutral core. Make the first release read-only and student-focused: discover the user’s courses, traverse folders, read page text, list files, retrieve permitted files, inspect announcements/news, and expose calendar/deadline information with provenance. Add writes only after explicit institutional approval, a permission model, confirmation UX, and a test tenant.

Use official ILIAS SOAP where the ADAM administrators enable it and document its permitted operations. ILIAS documentation says that SOAP is administered under `Administration > Users and Roles > Authentication and Registration > SOAP` and, since ILIAS 10, the endpoint is `/soap/server.php` (https://docu.ilias.de/ilias.php?baseClass=illmpresentationgui&obj_id=16155&ref_id=951). If SOAP is unavailable, do not assume that a student can enable it: use a local connector that operates through the user’s browser session, or a carefully rate-limited HTML client as a last resort. Do not ask users to paste SWITCH edu-ID credentials into a model.

MCP is the right compatibility layer for “students plug in their own AI model”: it standardizes the tool/resource interface while leaving the model and host choice open. It is not an ADAM API and cannot bypass ADAM authorization. A2A is complementary for agent-to-agent delegation, while LTI is useful if the project later becomes a tool launched inside an LMS; neither replaces the ADAM data adapter.

## What ADAM is and what was observed

ADAM is the University of Basel learning platform based on open-source ILIAS. The current authenticated pages identified themselves as **ILIAS 10.10** and used the host `https://adam.unibas.ch`.

The dashboard showed semester filters, course cards, a global search entry point, calendar, news, mail status, and tasks. Course links used stable-looking forms such as `https://adam.unibas.ch/go/crs/{ref_id}`; folder links used `go/fold/<ref_id>`. A populated course contained ordinary HTML page text (course description, preparation guidance, exam date/location, and schedule) plus folders for notes and exercises. Notes contained a PDF; the exercises folder could be empty. A connector must read both structured object listings and unstructured page text; it must not infer “no deadlines” merely because a folder is empty.

Dashboard news identified a newly added file, its course and folder, creation/update times, access class (“Authenticated Users”), and author. This is a useful provenance model for an agent response. Personal dashboard data, course membership, mail, learning progress, and files are user-scoped and potentially sensitive.

ADAM’s usage agreement (version 14 August 2025) says ADAM is for study and teaching, is not long-term storage, data is automatically deleted after twelve semesters, and ADAMtools data after twelve months. It says SWITCH edu-ID is the normal University of Basel login; public courses can be read without an account; credentials must not be shared; copyright, Swiss data-protection law, and object-specific provider rules apply. It also says learning-progress data is shown individually to learners but only aggregated/anonymized to course administration (https://adam.unibas.ch/goto_adam_file_1428835_download.html).

These terms should be treated as product requirements, not merely legal footnotes: default to minimum data, make external-model transmission visible, preserve links and authorship, and avoid indexing or retaining course material by default.

## MCP architecture relevant to this project

MCP uses JSON-RPC 2.0 to connect a host (the AI application), an MCP client (the host’s connector), and an MCP server (the service exposing context and actions). Servers can expose **tools**, **resources**, and **prompts**. The current specification describes tools as model-discoverable functions with JSON Schema input and optional output schemas (https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

The current specification revision (2026-07-28) is materially different from many older tutorials: it removes protocol-level sessions and the `Mcp-Session-Id` header, makes requests carry version/capability metadata, adds `server/discover`, and favors explicit state handles. It also deprecates HTTP+SSE in favor of Streamable HTTP and deprecates Dynamic Client Registration in favor of Client ID Metadata Documents, while retaining DCR for compatibility (https://modelcontextprotocol.io/specification/2026-07-28/changelog). Pin a protocol version and SDK version in any future implementation; support the compatibility matrix rather than copying a 2024 example.

The standard transports are stdio (the client launches a subprocess) and Streamable HTTP (HTTP POST to one MCP endpoint, with a JSON response or request-scoped stream). Custom transports are possible but must preserve JSON-RPC semantics and metadata (https://modelcontextprotocol.io/specification/2026-07-28/basic/transports). Recommended distribution:

* **Local mode:** stdio, ideal for a student’s own machine and browser/session helper. Credentials stay in the OS/browser or environment; do not print anything except valid MCP messages on stdout.
* **Hosted mode:** Streamable HTTP behind HTTPS, only if an operator is willing to run the service. Implement OAuth discovery, PKCE, resource indicators, audience validation, short-lived tokens, scoped consent, and secure token storage. The MCP authorization specification requires protected-resource metadata and OAuth 2.1-compatible discovery for HTTP servers (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

Official Tier 1 SDKs exist for TypeScript, Python, C#, Go, and Rust; Java is Tier 2 and PHP/Ruby/Kotlin/Swift are lower tiers (https://modelcontextprotocol.io/docs/2026-07-28/sdk). Python or TypeScript are the most accessible choices for a student project. Keep the adapter independent of the SDK so an MCP revision does not force a rewrite.

Tool design rules:

* Prefer narrow, read-only tools: `adam_list_courses`, `adam_get_course`, `adam_list_children`, `adam_read_page`, `adam_list_files`, `adam_get_file`, `adam_search`, `adam_list_calendar`, and `adam_list_news`.
* Require stable IDs (`ref_id`) and return canonical ADAM URLs, object type, title, breadcrumb, timestamps, access classification, and source URL.
* Use structured output plus concise text for model compatibility. Paginate listings and include freshness/provenance metadata.
* Return actionable tool execution errors (`isError: true`) for authorization, not-found, stale IDs, rate limits, and unsupported object types.
* Expose writes as separate tools (`adam_post_message`, `adam_submit_assignment`, etc.) only after approval. Each should show a human-readable preview, require explicit confirmation in the host, support idempotency keys, and record an audit event.
* Never expose a generic “run arbitrary ADAM request”, SQL, browser JavaScript, or unrestricted download tool.

## Three integration strategies

### A. Official ILIAS SOAP adapter (preferred when Basel approves)

ILIAS documents SOAP APIs by major version and exposes the SOAP administration endpoint for ILIAS 10 at `/soap/server.php` (https://docu.ilias.de/goto_docu_webr_1554.html). The adapter should generate or hand-wrap only the operations that ADAM administrators approve. Map SOAP results into a stable internal model and include the upstream ILIAS version in diagnostics.

Advantages: server-defined permissions, less brittle than HTML, suitable for a hosted gateway, and easier to audit. Risks: ADAM may not have SOAP enabled; operations may be administrative rather than learner-safe; SOAP APIs can change by ILIAS release; SWITCH login does not automatically mean an OAuth token for SOAP. Obtain written permission and an API/service-account policy from the ADAM team before relying on it.

### B. Local browser/session bridge (best student fallback)

A local helper can use the user’s existing ADAM browser session and read the visible, authorized pages. It should be explicit, local-only, and read-only by default. A browser extension/native-messaging bridge or a Playwright-based helper can extract page content and download links without ever asking the model for credentials. Chrome documents Native Messaging as the extension-to-local-process mechanism (https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Advantages: works with SWITCH edu-ID and MFA because the user authenticates normally; no institutional OAuth deployment; a student can run it independently. Risks: DOM and URL changes, CSRF/write hazards, browser-profile privacy, extension permissions, downloads, and anti-automation controls. Use allowlisted hostnames, a separate browser profile if possible, content-size limits, no arbitrary navigation, no writes in v1, no cookie export, and clear indicators of which page content is being sent to the model. Treat all page content as untrusted prompt-injection material.

### C. HTML/session client or synchronization cache (last resort)

An HTTP client can follow ILIAS links and parse pages, or synchronize selected files for local search. Open-source precedent exists: PFERD supports generic ILIAS crawling, course IDs/permanent URLs, keyring credentials, two-factor prompts, rate limits, and configurable inclusion of videos/forums (https://github.com/Garmelon/PFERD; https://github.com/Garmelon/PFERD/blob/master/CONFIG.md). An older community ILIAS REST plugin provides API keys, OAuth 2.0, CRUD, and custom routes, but it is an administrator-installed ILIAS plugin and is not evidence that ADAM exposes that API (https://github.com/hrz-unimr/Ilias.RESTPlugin).

Advantages: can support offline indexing and non-MCP clients. Risks: brittle scraping, copyright/privacy retention, duplicate/stale files, credentials, load on ILIAS, and accidental disclosure to embeddings or external LLMs. If used, default to on-demand retrieval, cache metadata only, encrypt local files, provide deletion/export controls, use conditional requests, one low-concurrency worker, randomized schedules, and honor robots/terms and ADAM rate guidance.

## Security, privacy, and trust model

The trust boundary is: student/model host → MCP client → adapter/gateway → ADAM. The model is not trusted with credentials. Page text, filenames, announcements, and PDFs are untrusted inputs and may contain prompt injection. The adapter must never let retrieved text alter authorization or tool policy.

For a hosted server, use per-user OAuth or an institution-approved delegated flow. Validate issuer, token audience, expiry, scopes, and PKCE; never pass the MCP bearer token through to ADAM. Issue a separate upstream credential/token or use a server-side session. Scope examples: `courses:read`, `content:read`, `calendar:read`, `news:read`, and later separately `messages:write` or `submissions:write`. Make scope elevation incremental.

For local mode, store no ADAM password. Use OS keyring only for non-session configuration, keep cookies in the browser, and make logs redact URLs with tokens, cookies, email addresses, and document content. Do not send full PDFs to an external model automatically. Offer a local extraction mode and per-call confirmation for private content.

Controls required before writes: human confirmation, preview/diff, object and course scope, CSRF protection, idempotency, timeouts, rate limits, audit log, and a kill switch. Never automate exams, graded submissions, enrollment decisions, role changes, mass messaging, or learning-progress manipulation in the first release.

MCP itself recommends human control, visible tool invocation, input validation, access control, rate limiting, output sanitization, result validation, timeouts, and audit logs (https://modelcontextprotocol.io/specification/2026-07-28/server/tools). A security review should also consider confused-deputy attacks, token passthrough, SSRF, malicious files, archive bombs, path traversal, oversized responses, model exfiltration, and cross-course data mixing.

## Product uses with high student value

1. “What changed in my courses?”: compare news and file metadata since a timestamp; link to the original object.
2. “Find the exercise sheet about Fourier transforms”: search titles/page text, return course/folder breadcrumbs and a canonical link.
3. “Prepare my week”: combine ADAM calendar, page-embedded dates, announcements, and explicit uncertainty where dates were inferred.
4. “Explain this PDF”: fetch only after confirmation, extract locally when possible, cite page numbers and source URL.
5. “Show all resources for course X”: traverse folders with pagination and object-type summaries.
6. “Open the material in ADAM”: return a link; let the host/browser handle navigation.

Keep mail, grades, learning progress, submissions, and personal data disabled unless the user explicitly enables a separate scope. Never claim access to content that the current account cannot see.

## Alternatives and how they fit

* **OpenAPI/REST:** useful as the internal adapter contract or if Basel exposes REST. OpenAPI describes HTTP endpoints but does not by itself give model discovery, consent, or tool semantics. The ILIAS REST plugin precedent is administrator-installed and must be evaluated for ILIAS 10 compatibility.
* **SOAP:** likely the most direct official ILIAS integration when enabled; wrap it behind a modern internal interface.
* **WebDAV:** useful for file synchronization where ADAM enables it, but it does not model courses, news, page text, permissions, or writes safely.
* **LTI 1.3/LTI Advantage:** appropriate for launching an external learning tool from an LMS, sharing launch identity/roles, deep linking, assignments, and grades (https://community.1edtech.org/viewdocument/introduction-to-lti-advantage). It is not a general student-facing read API for ADAM; investigate only if the project becomes an embedded teaching tool.
* **A2A:** complementary protocol for independent agents to delegate work; MCP remains the agent-to-tool interface (https://a2a-protocol.org/latest/).
* **WebMCP:** a September 2026 W3C Community Group draft allowing web applications to provide JavaScript tools to agents (https://webmachinelearning.github.io/webmcp/). It is not a stable replacement for a server-side or local MCP bridge and should be treated as an experiment.
* **No protocol / CLI:** a well-designed `adam` CLI and local library can be valuable independently. Add MCP as a thin compatibility layer so students can use shell scripts, notebooks, RAG tools, or any model framework.

## Suggested repository and implementation boundaries

Keep these modules separate:

* `adam-core`: typed domain objects, canonical URL/ref-ID handling, pagination, provenance, errors, and redaction.
* `adam-provider-soap`: versioned SOAP client, only enabled operations, contract tests.
* `adam-provider-browser`: local browser/session provider with host allowlist and read-only policy.
* `adam-provider-html`: optional fallback parser, fixtures only in tests, strict rate limiter.
* `adam-mcp`: MCP tools/resources/prompts, schema versioning, transport configuration, and capability filtering.
* `adam-auth`: browser handoff or institutional OAuth; no credential collection in chat.
* `adam-cli`: diagnostics, login handoff, course export, and local extraction.
* `docs`: threat model, data-flow diagram, provider capability matrix, ADAM setup, privacy notice, and model-host setup examples.

Use fixtures generated from synthetic or public ADAM courses. Do not commit private screenshots, cookies, course files, emails, names, or identifiers. License the project compatibly with the ILIAS GPL ecosystem and check any dependency/API license before redistribution.

## Verification plan before a first public release

* Confirm with University of Basel/ADAM administrators whether an API, SOAP endpoint, plugin, OAuth/OIDC integration, WebDAV, rate limit, or test tenant is available.
* Capture the exact ADAM/ILIAS version and supported SOAP operations; add compatibility tests for ILIAS 10 minor upgrades.
* Test anonymous public course reads separately from authenticated reads; verify that inaccessible course IDs cannot be enumerated.
* Test German and English labels, Unicode filenames, long titles, duplicate names, empty folders, nested folders, links, PDFs, videos, and page-embedded dates.
* Test expired sessions, MFA, reauthentication, revoked membership, permission changes, 401/403/404, timeouts, throttling, retries, and partial downloads.
* Run MCP conformance/Inspector checks, schema validation, deterministic `tools/list`, pagination, cancellation, and protocol-version negotiation.
* Threat-model prompt injection and confused deputy behavior; fuzz tool inputs, URLs, archive extraction, filenames, and large responses.
* Measure request volume and latency against a quiet test environment. Default to concurrency 1 and bounded response sizes.
* Conduct a privacy/copyright review with Basel stakeholders. Document retention, external-model processing, user deletion, and incident response.

## Open questions to resolve with ADAM/ITS

1. Is `/soap/server.php` enabled on production ADAM, and which methods are approved for student self-access?
2. Is there an institution-approved OAuth/OIDC client or delegated API flow for SWITCH edu-ID?
3. Are local browser extensions/native messaging acceptable under Basel endpoint policy?
4. What are permitted request rates, caching periods, and download/storage rules?
5. May course pages and files be sent to third-party model providers, and which data classes must remain in Switzerland or on-device?
6. Which object types are in scope: files, pages, folders, calendars, news, forums, mail, tests, assignments, grades, learning progress, ADAMtools, EtherPad, Panopto, Turnitin?
7. Is there a sandbox/test course and a designated maintainer for compatibility reports?
8. Does Basel want an official service, a community project, or a student-operated personal connector? Branding and liability differ substantially.

## Sources consulted

* ADAM dashboard and authenticated course pages in the user’s Chrome session: `https://adam.unibas.ch`
* ADAM usage agreement: https://adam.unibas.ch/goto_adam_file_1428835_download.html
* ILIAS SOAP administration: https://docu.ilias.de/ilias.php?baseClass=illmpresentationgui&obj_id=16155&ref_id=951
* ILIAS SOAP documentation index: https://docu.ilias.de/goto_docu_webr_1554.html
* ILIAS source repository and GPL-3.0 project description: https://github.com/ILIAS-eLearning/ILIAS
* ILIAS REST plugin precedent: https://github.com/hrz-unimr/Ilias.RESTPlugin
* PFERD ILIAS crawler: https://github.com/Garmelon/PFERD and https://github.com/Garmelon/PFERD/blob/master/CONFIG.md
* MCP specification overview: https://modelcontextprotocol.io/specification/latest
* MCP 2026-07-28 changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog
* MCP transports: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
* MCP authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
* MCP tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
* MCP SDKs: https://modelcontextprotocol.io/docs/2026-07-28/sdk
* MCP Inspector: https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector
* Chrome Native Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
* 1EdTech LTI Advantage: https://community.1edtech.org/viewdocument/introduction-to-lti-advantage
* A2A relationship to MCP: https://a2a-protocol.org/latest/
* WebMCP draft: https://webmachinelearning.github.io/webmcp/

