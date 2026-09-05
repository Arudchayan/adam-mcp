# Contributor notes

Local stdio MCP server for University of Basel ADAM. Users: [README.md](README.md). Scope: [docs/scope.md](docs/scope.md).

## Layout

| Package | Role |
| --- | --- |
| `packages/core` | Types, canonical URLs, pagination, redaction |
| `packages/mcp` | Tools, resources, prompts, stdio entry |
| `packages/provider-fixture` | Default synthetic catalog |
| `packages/provider-browser` | Live ADAM via a dedicated Chrome profile |
| `packages/provider-soap` | Fail closed |
| `packages/provider-html` | Fail closed |

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run setup    # build + print host JSON
npm run login    # Chrome ADAM session
```

Default provider is `fixture`. Live ADAM is `--browser` / `ADAM_PROVIDER=browser`.

## Invariants

- Do not put SWITCH passwords in tools, env, logs, issues, or git.
- No write tools. Object type `tst` is denied.
- `adam_read_page` and `adam_extract_file_text` require `confirm: true`. Return text, never file bytes.
- stdout is JSON-RPC only. Logs go to stderr.
- Pin origin to `https://adam.unibas.ch`. No generic URL fetch.
- Do not commit cookies, Chrome profiles, live course files, or private screenshots.
- Enabling SOAP/HTML, adding a tool, or changing extract/session behavior needs an ADR in `docs/adr/`.

## Docs map

| File | Use |
| --- | --- |
| `README.md` | Users |
| `docs/setup.md` | Host JSON and login |
| `docs/architecture.md` | How the process is wired |
| `docs/scope.md` | Tools and out-of-scope |
| `docs/providers.md` | Fixture vs browser |
| `SECURITY.md` | Reports and publish checklist |
| `docs/research/` | Dated 2026-09-05 notes, not current rules |
