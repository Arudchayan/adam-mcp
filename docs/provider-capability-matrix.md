# Provider capability matrix

Status as of 5 September 2026. “Live” means the provider can reach production ADAM with the current user’s authorization.

| Capability | Fixture | SOAP | Browser session | HTML |
| --- | --- | --- | --- | --- |
| Enabled | Yes (default) | No | Yes (local Chrome profile) | No |
| List courses | Synthetic | Disabled (Apache 403) | Live, if signed in | Disabled |
| Get course | Synthetic | Disabled | Live, if signed in | Disabled |
| List children | Synthetic | Disabled | Live, if signed in; `tst` omitted | Disabled |
| Read page text | Synthetic | Disabled | Live, if signed in; MCP requires `confirm=true` | Disabled |
| List / get file metadata | Synthetic | Disabled | Live, if signed in | Disabled |
| Local file extract (text only) | Synthetic PDF literals | Disabled | Live download into the local process; no bytes to the model | Disabled |
| Read-only exercise | Synthetic | Disabled | Live page heuristic; no submit | Disabled |
| File bytes to the model | Never | Never | Never | Never |
| Search | Synthetic catalog | Disabled | Dashboard + enrolled course/folder titles (capped walk; not ILIAS global search) | Disabled |
| Calendar | Synthetic | Disabled | Dates inferred from dashboard and enrolled course/folder/exercise pages | Disabled |
| News | Synthetic | Disabled | Dashboard HTML articles when present | Disabled |
| Tests (`tst`) | N/A in catalog | Disabled | Denied | Disabled |
| Writes | No | No | No | No |
| Credentials in chat | No | No | No — SWITCH stays in Chrome | No |
| Live ADAM | No | Apache 403; SOAP login ≠ SWITCH | Dedicated local Chrome profile | Last resort, fail closed |

SOAP remains a future official adapter only if `/soap/server.php` actually serves WSDL **and** a learner-safe, non-password path exists. Today it does not. SWITCH OIDC is not wired to ADAM (SAML SP only).
