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
