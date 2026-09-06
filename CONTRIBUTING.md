# Contributing

Thanks for helping improve ADAM MCP. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Quick checks

Before you open a PR:

```bash
npm install
npm test
npm run typecheck
```

**Fixture-first:** PRs must pass on the fixture catalog. Do not require production ADAM (or a live Chrome session) in CI.

## Setup

1. Fork the repo, then clone your fork.
2. `npm install`
3. `npm run setup` — use the **fixture** MCP snippet in your client and confirm tools respond.
4. Optional live ADAM: `npm run login`, sign in in Chrome, then use the `--browser` snippet. Leave that Chrome window open. See [AGENTS.md](AGENTS.md) and [docs/setup.md](docs/setup.md).

## What to open where

| Intent | Where |
| --- | --- |
| Something is broken | [Bug report](https://github.com/Arudchayan/adam-mcp/issues/new?template=bug.md) |
| New Uni Basel ADAM workflow / capability | [Feature request](https://github.com/Arudchayan/adam-mcp/issues/new?template=feature.md) |
| Security concern | [SECURITY.md](SECURITY.md) (advisory preferred) |

Do **not** attach SWITCH passwords, cookies, Chrome profiles, live course PDFs, or private screenshots.

## Pull requests

1. Keep changes focused; prefer small PRs.
2. Use the PR template (summary + fixture-safe test plan).
3. Ensure CI is green (`npm test`, `npm run typecheck`, build, audit on the matrix).
4. New tools, providers, or extract/session behavior: add a short ADR under `docs/adr/` and follow [docs/scope.md](docs/scope.md).
5. P0 surfaces (session, allowlist, writes, bytes, `tst` / `exc`) should be reviewed by someone who did not author the patch.
6. Never commit credentials, session material, or real student data.

## Versioning and releases

Release tagging and publish gates live in [SECURITY.md](SECURITY.md). User-facing changes go in [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog / SemVer). Do not tag or publish to npm from a docs-only PR unless Security has signed off the publish checklist.
