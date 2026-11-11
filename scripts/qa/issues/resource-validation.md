# Resources serialize malformed metadata rejected by matching tools

Severity: low reliability hardening, conditional on provider error. Tested source `ef9776e`; independently reproduced.

```sh
node --import tsx --test --test-name-pattern="R3:" scripts/qa/mcp-boundaries.repro.mjs
```

Override the synthetic fixture provider's getFile to return a file with numeric title, null URL and empty provenance. `adam_get_file` rejects it as nonretryable `provider_unavailable`; `resources/read adam://file/100011` succeeds with the malformed metadata.

Resource handlers call `resourceJsonText` without the corresponding shape validation used by `ok()` for tools.

## Expected / acceptance

- Fail closed consistently for malformed provider metadata on resource and tool paths.
- Preserve untrusted envelopes, redaction, metadata-only resource policies and resource error taxonomy.
- Cover malformed nested fields and valid resource compatibility.

Resources advertise JSON MIME, not tool output schemas: this is **not** an MCP output-schema violation. No malformed live-browser result or privacy exposure was established. Reproduction uses synthetic metadata only.
