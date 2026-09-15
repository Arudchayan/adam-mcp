# Providers

Default is **fixture** (synthetic catalog). Live ADAM is **browser** (`--browser`). SOAP and HTML are in the repo and stay disabled.

| Capability | Fixture | Browser | SOAP | HTML |
| --- | --- | --- | --- | --- |
| Enabled | Yes (default) | Yes | No | No |
| Courses / folders / files | Synthetic | Live session | Disabled | Disabled |
| Page text | Synthetic | Live; `confirm=true` | Disabled | Disabled |
| File extract | Synthetic PDF literals | Local download → text | Disabled | Disabled |
| Search | Catalog titles/text | Enrolled objects, capped | Disabled | Disabled |
| Calendar / news | Catalog | Pages you can see | Disabled | Disabled |
| Tests (`tst`) | Not in catalog | Denied | Disabled | Disabled |
| Writes | No | No | No | No |

SOAP `/soap/server.php` was HTTP 403 on production ADAM (5 Sep 2026). SOAP `login` would also be a local WS password, not SWITCH. HTML remains a last-resort parser, not a student path.

## Performance notes (browser)

Hotspots and existing mitigations (do not raise concurrency without an ADR):

| Hotspot | Behavior | Mitigation |
| --- | --- | --- |
| Playwright nav | All CDP work through `SerialQueue` (concurrency 1) | Keeps session races down; long walks feel sequential |
| Enrolled walk | Caps at `MAX_LIVE_PAGES` (48); used by search / calendar / news | Shared `livePagesMemo` + slim page retention (PERF-1); memo hits skip re-walk and progress |
| Listing | Type probes for `list_children` / `list_files` | `listingFastFail` (preferred type + ≤1 retry) |
| `getExercise` | Opens one `/go/exc/{refId}` | Prefer `type` from parent listing; not a full enrolled walk |
| File extract | Local download + text parse | Size/page caps; unrelated to exercise HTML |

Tool call duration (`ms`) is already logged on stderr (ADR 0008). Prefer measuring with that line rather than adding parallel browsers.
