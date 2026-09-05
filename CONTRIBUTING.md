# Contributing

This is a student-operated connector, not an official University of Basel project.

## Rules

- Never commit SWITCH edu-ID passwords, cookies, Chrome profiles, live course PDFs, or private screenshots.
- Pull requests must pass on fixtures. Do not require production ADAM in CI.
- Do not paste credentials into issues or chat transcripts.
- New tools, providers, or file-extract modes need a short ADR in `docs/adr/` that answers the questions in `docs/product-spec.md` (review protocol).
- P0 surfaces (session, allowlist, writes, bytes, `tst`/`exc`) cannot be self-merged by the author.

## Dev

```bash
npm install
npm test
npm run typecheck
```

- Default `ADAM_PROVIDER` is `fixture`. Live ADAM is `--browser` after `npm run setup` and `npm run login`.
