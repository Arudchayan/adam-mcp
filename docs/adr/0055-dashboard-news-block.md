# ADR 0055: Dashboard News block in `adam_list_news`

## Status

Accepted (Dashboard items). News block pagination: deferred until a capture shows the page key.

## Context

Issue #132 (news slice). `adam_list_news` read only page 1 of each course `block_news_{id}` (#118, PR #141). A structure-only live probe of ILIAS 10.12 on ADAM shows:

- The Dashboard (`ilias.php?baseClass=ilDashboardGUI&cmd=jumpToSelectedItems`, already the enrolled walk's home page) has a `block_pdnews_{id}` panel with the same KS item shape as the course block: `il-item-title` link, `il-item-description`, `Date` property. Item links are `cmdClass=ilPDNewsBlockGUI&cmd=showNews&block_type=pdnews&news_id=…`. Its panel controls include **Get Feed URL** (`cmd=showFeedUrl`, a token-bearing feed) and **Settings** (`cmd=editSettings`).
- Both blocks paginate through `.il-viewcontrol-pagination` buttons whose `data-action` routes go to `cmdClass=ilcolumngui&block_type=news|pdnews&…`. The probe recorded the route prefix only, not the query key that carries the page index.

## Decision

- Unscoped `adam_list_news` also returns the Dashboard `block_pdnews` items from the home page it already opens. No extra page load.
- Dashboard items cite the Dashboard URL (fixed, with no session query keys) and leave `courseRefId` unset. The page doesn't name their course, so we don't invent one.
- Items carry the ILIAS `news_id` as an optional `newsId`. When the same `news_id` shows up on the Dashboard and in a course block, the course row wins (it names its course) and keeps the position where the news first appeared.
- A course-scoped call stays course-only, since the walk drops the home page for scoped reads.
- The parser never follows any block control: pagination, Get Feed URL and Settings stay untouched.
- **Pagination is not implemented.** Following the advertised `data-action` routes needs an exact allowlist, as with ADR 0030 / 0052: pinned origin, `/ilias.php`, exact `baseClass` / `cmdClass=ilcolumngui` / `block_type`, allowlisted non-duplicated keys and a bounded page index. The page-index key isn't in the evidence, and guessing it would break that rule. The follow-up needs a structure-only capture of one course and one Dashboard pagination button's full query-key list, plus whether the route returns a full page or an async fragment. With that, a follow-up can read up to 5 more pages per block inside the walk budget and stop at the `since` cutoff.

## Consequences

Unscoped news gains Dashboard items, including news from objects the walk doesn't open. `newsId` is a new optional output field; the news schema already passed through extra fields. Dashboard rows have no `/go/` citation, so they get no resource handle. Live verification is still needed for the Dashboard item count, `Date` parsing and `news_id` overlap with course blocks.
