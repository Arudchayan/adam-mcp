# Download HTML refusal is bypassed by UTF-16 or prefix padding

Severity: low integrity/documentation hardening. Tested source `ef9776e`; independently reproduced. Not an execution vulnerability.

```sh
node --import tsx --test --test-name-pattern="HTML original" scripts/qa/adversarial-downloads/boundary-repros.ts
```

Two synthetic HTML responses, both octet-stream MIME and one-byte chunks, produce successful original-file saves:

- UTF-16LE BOM HTML: 98 bytes.
- HTML after 1,024 ASCII spaces: 1,072 bytes.

The saved bytes match exactly. UTF-8 BOM HTML and explicit HTML MIME are correctly refused by control tests.

`packages/core/src/local-extract.ts` decodes a bounded 1,024-byte prefix as UTF-8; the sink stops sniffing when that prefix fills. `docs/downloads.md` categorically advertises HTML-shaped response refusal.

## Expected / acceptance

Support an explicitly bounded encoding-aware check where practical, and accurately document residual sniffing limitations. Keep memory/transfer caps and cleanup; do not solve padding with unbounded buffering. Add regressions for split BOMs and misleading MIME.

Requires missing/misleading MIME. The padding case is a bounded heuristic limitation, not a proven security-boundary bypass. Downloads are never automatically opened. No live course content or login response was downloaded.
