# Live re-verify guide (bounded, privacy-safe)

For the post-population ADAM pass (new documents/files). No code changes. Phase A gates stay fixture-only; live never gates CI.

## Stop rules (abort if any)

- Login page / `unauthorized` → re-run `npm run login`, never paste SWITCH password.
- Home listing `unknown` → report partial, do not deepen.
- 3 consecutive `not_found`/timeout, walk exceeds 5 min or 48 pages, any PII/cookie in capture preview.
- User asks to open a non-allowlisted URL.

## Bounded sequence (no `every crs` fan-out)

1. `npm test && npm run typecheck` green before live.
2. `ADAM_DEBUG_CAPTURE=1 ADAM_DEBUG_CAPTURE_DIR=./scratch` only (gitignored, structure-only, no text/titles/cookies/bytes).
3. `adam_session_status` (ignore one cold-start `login.php` false-negative; ADR 0007 re-checks).
4. `adam_list_courses` → record count delta (was 8).
5. `adam_list_children` on one known `crs` + `2291290/2291292` with explicit `type:fold` → `ok`? `empty`? still `unknown+blank-notice`?
6. Single `adam_search` (`pdf`), then `adam_list_news` / `adam_list_calendar` with `onProgress`. No extract crawl.
7. If a `file` appears: `list_files` → `get_file` (metadata only) → one `read_page`/`extract_file_text` with `confirm:true` (text only).
8. If an `exc` appears: distinguish empty Exercises **fold** (`100020`-case) vs **exc** with deadline (`100021`-case). Check `source/confidence`, dedup `exc>calendar>page`.

## Capture / promote (never commit `scratch/`)

- `node scripts/capture-fixtures.mjs --out scratch/live-candidate` (never default out). Targets are dashboard + known courses/folds; copy script to `scratch/` to add new URLs (do not commit real refIds).
- Scrub audit `scratch/live-candidate`: grep real IDs, `@`, `title != redacted`, over-long `text`, `cookie|set-cookie|storageState`. `KEEP_TEXT` diff review (UI chrome/empty-copy only).
- Promote only by explicit PR copying vetted files to `packages/provider-browser/fixtures/live/`; update `live-replay.test.ts` expectations together (`unknown→ok` flips are `needs-review`, not silent).
- `capabilities.md`: append dated `Live pass (YYYY-MM-DD, <build>)` paragraph (counts, types, `listingState`/`notice` only). Flip matrix cells only with DOM evidence. Never add filenames, instructor names, deadlines-as-facts beyond provenance, real refIds, screenshots.

## Copyright / privacy

- Text extract only, single-file sanity, no mass crawl / RAG corpus, no bytes/base64 to model.
- Never commit: passwords, cookies/storage, profiles, `DevToolsActivePort`, live PDFs/text, real refIds/titles/names/emails, screenshots/video, unscrubbed captures.

See `docs/capabilities.md` §7, `docs/ROADMAP.md` Phase B gates, ADR 0007 §6 (capture), ADR 0010/0011 (protocol/bounds).
