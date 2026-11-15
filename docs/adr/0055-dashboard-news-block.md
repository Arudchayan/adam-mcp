# ADR 0055: Dashboard News block in `adam_list_news`

## Status

Accepted. Amended 2026-11-15: bounded News block pagination (see Amendment). That replaces the "Pagination is not implemented" bullet below.

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

Unscoped news gains Dashboard items, including news from objects the walk doesn't open. `newsId` is a new optional output field; the news schema already passed through extra fields. Dashboard rows have no `/go/` citation, so they get no resource handle. Live verified (PR #153): 32 dated news items, all with `newsId`, no duplicates.

## Amendment: bounded block pagination (2026-11-15)

A structure-only live probe recorded the full routes behind the pagination buttons. Both are full-page routes, not async fragments:

- Course `block_news_{blockId}`: `/ilias.php?baseClass=ilrepositorygui&cmdNode=…&cmdClass=ilcolumngui&ref_id={course}&col_side=right&block_type=news&news_{blockId}_blnavpage={N}`
- Dashboard `block_pdnews_{blockId}`: `/ilias.php?baseClass=ildashboardgui&cmdNode=…&cmdClass=ilcolumngui&view=0&show={hex}&col_side=right&block_type=pdnews&pdnews_{blockId}_blnavpage={N}`

`N` is 0-based: button "1" is 0 and the chevron is the current page + 1.

Decision:

- `adam_list_news` follows a block's later pages **only** through routes taken verbatim from that block's own `.il-viewcontrol-pagination` `data-action` buttons, and only the route for the next page (current + 1).
- A route must pass an exact allowlist:
  - pinned origin and `/ilias.php`, no credentials or fragment
  - `baseClass` that matches the block type (`ilrepositorygui` for `news`, `ildashboardgui` for `pdnews`)
  - `cmdClass=ilcolumngui` and `block_type` equal to the block's type
  - `cmdNode` matching `^[a-z0-9:]{1,40}$` and `col_side` of `left` or `right`
  - for course blocks, `ref_id` equal to the page's course; for the Dashboard, `view` as digits and `show` matching `^[0-9a-f]{1,64}$`
  - exactly one paging key, `{block_type}_{blockId}_blnavpage`, where blockId is the block's own id and the value is a 0–99 integer
  - no other keys and no duplicates; there is no `cmd`, so Get Feed URL and Settings can never pass
- Limits:
  - at most 5 extra pages per block
  - a block stops at its last advertised page, or after a page whose dated items are all older than `since` (pages are newest first)
  - extra opens per call are capped at the walk page cap (48)
  - walk and paging share one read budget (`walkTimeoutMs`, two minutes) measured from the start of the call
  - an unreadable later page makes the result partial (`unreadable_page`) and keeps what was read
- Order and reserve (revised after the live check of PR #158). Live, the enrolled walk used about 103 s of the 120 s budget. Paging every block in walk order added 2 items and made every unscoped result `partial: time_budget`. So:
  - **The Dashboard `block_pdnews` is paged first.** It aggregates news from every enrolled course (12 pages live), so its extra pages are worth the most.
  - **Course blocks are paged only when the Dashboard didn't cover them**: either the walk has no Dashboard block (course-scoped calls), or the Dashboard block stopped for some reason other than reaching its last page or `since` (its 5-page cap, the budget, an unreadable page). Dedupe by `newsId` still applies.
  - **Reserve:** no new News page is opened once less than `min(10 s, budget / 10)` of the shared budget is left, so the call ends before the two-minute limit.
  - **Partial only when it matters:** running out of time or page budget sets `time_budget` / `page_budget` only if it cut short the Dashboard block, or a course block in a walk with no Dashboard block. Course blocks left unpaged after the Dashboard was read don't make the result partial. Their page 1 is already in the result, and the Dashboard pages read so far carry the newest cross-course news.
- Later pages read only the same block id. Their items keep page 1's citation and course, and dedupe by `newsId` with everything else. Pages are memoized per walk, so repeat calls on a cached walk don't reopen them.
- A course-scoped call pages only that course's block, because the Dashboard isn't part of a scoped walk. Folder-page News blocks don't page: their routes would carry the folder's `ref_id`, and that shape wasn't captured.

Needs live verification: each block reads at most 5 extra pages, routes match the captured shape (including the Dashboard `show` value), `since` stops early, and nothing opens `showFeedUrl` / `editSettings`.
