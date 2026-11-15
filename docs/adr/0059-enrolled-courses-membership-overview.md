# ADR 0059: Enrolled courses from the membership overview when the Dashboard shows none

## Status

Accepted

## Context

Live (2026-11-15, ILIAS 10.12): after a fresh sign-in, the Dashboard (`ilDashboardGUI&cmd=jumpToSelectedItems`, and `jumpToMemberships` too) rendered only its side blocks: Tasks, Calendar, News and Mail. Its centre column had no course list. `adam_list_courses` returned `listingState: "unknown"` (`chromeOnly`). Every enrolled walk therefore queued no courses, so search, calendar and news silently covered only the Dashboard blocks. The main bar's advertised **My Courses and Groups** route (`ilias.php?baseClass=ilmembershipoverviewgui`) still listed all 8 courses in a `block_dash_mem_{id}` panel. Earlier today the Dashboard did list them, so this view can change per account or session.

## Decision

- `enrolledListing()` decides where the enrolled course list comes from, for `adam_list_courses` and the enrolled walk alike:
  - **The Dashboard** when it verifies an `ok` listing that includes courses (unchanged behavior).
  - **The membership overview** when the Dashboard is `unknown`, or `ok` without any course. The overview is used only when it verifies an `ok` listing with courses itself.
  - An explicit empty Dashboard stays an honest `empty`, with no fallback.
- If the overview cannot be read (any error other than cancel or unauthorized), the Dashboard's own state is kept, so the fallback never invents or fails a listing.
- The walk still keeps the Dashboard page for its blocks (ADR 0051, 0055, 0056). Only the course list may come from the overview. Course-scope verification uses the same source.

## Consequences

One extra page load when the Dashboard shows no courses. Live: `adam_list_courses` went from `unknown` / 0 to `ok` / 8, and the unscoped news walk went from 5 partial items to 33 complete ones. The overview is a main-bar route already advertised to every user, and it is a plain read.
