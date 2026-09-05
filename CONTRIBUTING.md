# Contributing

```bash
npm install
npm test
npm run typecheck
```

- PRs must pass on the fixture catalog. Do not require production ADAM in CI.
- Do not commit SWITCH passwords, cookies, Chrome profiles, live course PDFs, or private screenshots.
- New tools, providers, or extract/session behavior: add a short ADR under `docs/adr/` and follow [docs/scope.md](docs/scope.md).
- P0 surfaces (session, allowlist, writes, bytes, `tst` / `exc`) should be reviewed by someone who did not author the patch.

Live ADAM is `--browser` after `npm run setup` and `npm run login`. See [AGENTS.md](AGENTS.md).
