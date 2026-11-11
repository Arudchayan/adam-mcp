# CLI download publishes unsolicited partial content as a complete original

Severity: medium integrity. Tested source: `ef9776e80dbb4b7d60d33b9547b6a0ce5e0daacd`; Windows, Node 24.19.0. Independently reproduced by a second reviewer.

## Reproduction

QA branch `qa/adversarial-2026-11-11`:

```sh
node --import tsx --test --test-name-pattern="unsolicited HTTP 206" scripts/qa/adversarial-downloads/boundary-repros.ts
```

The synthetic server returns status 206, `Content-Range: bytes 0-2/100`, `Content-Length: 3`, octet-stream MIME and body `abc`. The client requested no range. `saveLocalDownload` publishes a final file and success metadata with size 3 and a matching SHA-256, although the response explicitly describes only part of a 100-byte original.

## Expected / cause

Reject unsolicited partial content before publishing a final original. `bounded-fetch.ts` accepts all `response.ok` statuses and checks only the partial response's Content-Length. A correct hash verifies the received bytes, not completeness.

## Acceptance / limits

- Refuse unsolicited 206/partial responses and clean temporary files.
- Preserve ordinary complete streaming, cancellation, redirects, byte limits and collision protection.
- Add regression coverage at transfer and CLI-save boundaries.

All data and fetches are synthetic. Live ADAM/proxy occurrence was not established. No confidentiality, execution or arbitrary-write impact is claimed.
