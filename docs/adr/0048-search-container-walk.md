# ADR 0048: Search walks containers only, not ILIAS search

## Status

Accepted

## Context

Issue #126 item 1: a course-scoped `adam_search` took 30–120 s on 0.4.0 because it
used the shared enrolled walk, which opens every course, folder and exercise page in
headless Chrome. The issue asks for ILIAS's own search (`ilSearchControllerGUI` / the
metabar search drawer) instead.

That is not allowed. `https://adam.unibas.ch/robots.txt` disallows
`ilsearchcontrollergui`, and ADR 0001, `docs/scope.md` and the `adam_search` tool
description already say the server does not crawl it. This ADR keeps that rule. Items
2 and 3 of #126 (session drop after the time budget, reversed breadcrumbs) were fixed
separately (PR #134, PR #135).

Search matches titles from parent listings and body text from the opened page. An
exercise (`exc`) is a leaf: its title already appears in the listing of its course or
folder, and opening it only adds its own body text. Calendar and news still need
exercise pages for deadlines and blocks.

## Decision

- **Container walk for search.** On a cold cache, `adam_search` walks the dashboard,
  enrolled courses and folders only (`WalkMode = "containers"`). Exercise pages are not
  opened, so they no longer use up the page and time budgets. Exercise titles still
  match from listings. Skipping them does not mark the walk partial. Page, time,
  enrollment, cancellation and partial rules are unchanged (ADR 0005, 0015, 0028).
- **Reuse a full walk first.** If a fresh (60 s) or in-flight full walk exists for the
  same scope, for example after `adam_list_calendar` or `adam_list_news`, search uses or
  joins it rather than starting a second traversal of the single browser. Results then
  include exercise body matches as well.
- **Separate memo key.** Container walks are memoized under `containers:<scope>` with the
  same 60 s TTL, 32-entry bound, generation checks and no memo of partial results. A
  container memo never satisfies calendar or news.
- **No native search.** `ilsearchcontrollergui`, the metabar search drawer and the
  Magazin stay out of scope. Revisit only if robots.txt changes or Uni Basel documents
  a search API.

## Consequences

Cold searches open one page per course and folder, not one per exercise. Courses
with many exercise units should finish faster and hit `time_budget` less often.
Live timings are not measured here.

On a cold cache, text inside an exercise page body (instructions, deadline wording)
does not match. The same query can then return more body matches after a calendar or
news walk has warmed the cache. Use `adam_get_exercise` or `adam_list_calendar` for
exercise content and deadlines.

Fixture tests cover the open set of a cold search, title hits for exercises, memo
reuse, warm full-walk reuse and joining an in-flight full walk.
