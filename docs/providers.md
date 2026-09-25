# Providers

Default is **browser** (live ADAM via Chrome). `--browser` is a no-op alias. SOAP and HTML stay disabled. The synthetic catalog in `packages/provider-fixture` is for in-process tests only; `ADAM_PROVIDER=fixture` fail-closes at runtime (ADR 0017).

| Capability | Browser | Fixture (tests) | SOAP | HTML |
| --- | --- | --- | --- | --- |
| Enabled | Yes (default) | In-process tests only | No | No |
| Courses / folders / files | Live session | Synthetic | Disabled | Disabled |
| Page text | Live; `confirm=true` | Synthetic | Disabled | Disabled |
| File extract | Local download → text | Synthetic PDF literals | Disabled | Disabled |
| Search | Enrolled objects, capped | Catalog titles/text | Disabled | Disabled |
| Calendar / news | Pages you can see | Catalog | Disabled | Disabled |
| Tests (`tst`) | Denied | Not in catalog | Disabled | Disabled |
| Writes | No | No | No | No |

SOAP `/soap/server.php` was HTTP 403 on production ADAM (5 Sep 2026). SOAP `login` would also be a local WS password, not SWITCH. HTML remains a last-resort parser, not a student path.
