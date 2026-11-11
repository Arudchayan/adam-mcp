# Synthetic discovery QA

Tests and isolated failing contract checks only; no runtime changes. Base: `ef9776e80dbb4b7d60d33b9547b6a0ce5e0daacd`.

## Run

```sh
npm ci --ignore-scripts
node --import tsx --test packages/provider-browser/qa/adversarial-discovery/held.test.ts
node --import tsx --test packages/provider-browser/qa/adversarial-discovery/findings.repro.ts
npx tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --strict --skipLibCheck packages/provider-browser/qa/adversarial-discovery/held.test.ts packages/provider-browser/qa/adversarial-discovery/findings.repro.ts
```

On the base, the guardrails pass 7/7 and the intentionally failing repros exit 1 with 0/5 passing. Select an individual case with `--test-name-pattern="D3:"` before the file path. Both files are outside normal `src` test discovery; repros also use the `.repro.ts` suffix. The real-DOM cases require Chrome. They use a fresh browser context, block service workers, intercept all requests and abort unrecognized requests, with a unique temporary session metadata directory; no existing profile, holder, login or live ADAM content is used. All IDs and content are synthetic.

## Observed cases

- **D1 — empty dashboard search:** an explicitly empty dashboard containing a stray synthetic course link produces no `listCourses` items, but global title search returns that course without marking the result partial. Expected: no hit from the suppressed listing.
- **D2 — unknown course search:** a blank/unknown course listing suppresses a stray synthetic file in `listChildren`, but scoped title search returns it while correctly reporting partial. Expected: no hit from the suppressed listing.
- **D3 — mismatched DOM evidence:** in intercepted Chrome, an unparseable content-area row and an unrelated sidebar file link produce an `ok` listing containing the sidebar file. Expected: unknown listing with no verified children. The row and link are in different DOM regions.
- **D5 — unrelated date promoted:** `Deadline: not announced. Lecture starts 2026-11-12.` yields that lecture date as an exercise deadline. Calendar also promotes it to `source: exc`, `confidence: explicit`. Expected: no exercise deadline; a page-inferred date may remain as such.

These are synthetic correctness and inventory-honesty findings. They do not establish unauthorized access, file-content disclosure, or prevalence on live ADAM. Impact and severity require independent contextual assessment.

## Passing guardrails

The bounded tests exercise folder-tab URL mutations; listing classification combinations; snapshot cursor binding, replay and expiry; typed getter mismatches including denied test objects; non-ADAM link rejection; same-origin versus foreign frame inventory; and a seeded cyclic enrolled walk with unknown-branch pruning. The aggregate classification test does not prove DOM-region correlation, as D3 demonstrates.
