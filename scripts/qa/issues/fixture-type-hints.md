# Fixture page reads ignore denied object-type hints enforced by browser

Severity: low test-fidelity defect, **not exam disclosure**. Tested source `ef9776e`; independently reproduced.

```sh
node --import tsx --test --test-name-pattern="R4:" scripts/qa/mcp-boundaries.repro.mjs
```

In the internal fixture harness, approved `adam_read_page` for `adam://tst/100001` returns the otherwise allowed synthetic course body rather than rejecting the denied type hint. The actual synthetic test object's body remains blocked, and browser openObject rejects the supplied denied hint. Fixture runtime is disabled outside the internal harness.

Fixture readPage validates its stored record type but ignores options.type, unlike browser behavior.

## Expected / acceptance

Enforce denied/conflicting type hints consistently in fixture and browser reads. Add cross-provider contract tests while preserving the golden empty fold/exercise distinctions. Do not describe this as a production test-access bypass or allow actual denied bodies.
