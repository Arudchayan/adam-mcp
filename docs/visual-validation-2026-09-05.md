# Visual validation — 5 September 2026

Read-only, unauthenticated checks against production ADAM. No login, no cookie capture, no file downloads, and no private course content stored.

## Surfaces

| Surface | Result |
| --- | --- |
| `https://adam.unibas.ch` | Redirects to `https://adam.unibas.ch/login.php` |
| Login | SWITCH edu-ID is the primary control; “Login ohne Switch edu-ID” is secondary |
| Public courses | Linked from login as `https://adam.unibas.ch/go/cat/621897` |
| Catalog redirect | `/go/cat/621897` → `ilias.php?baseClass=ilrepositorygui&cmdClass=ilobjcategorygui&ref_id=621897` |
| Faculty example | `/go/cat/65` → Philosophisch-Naturwissenschaftliche Fakultät, nested department categories |
| Footer | `Rendered by its-ilias-web-prod-05 - 10.10 - 8.2.31` |
| SOAP | `GET /soap/server.php` and `GET /soap/server.php?wsdl` → HTTP 403 |

## Object types seen without login

`root`, `cat`, `blog`, `impr`. Course (`crs`), folder (`fold`), and file (`file`) types remain documented from the earlier authenticated research pass in `AGENTS.md` and are modeled only as **synthetic** fixture objects.

## What this does *not* validate

- Authenticated dashboard, mail, calendar widgets, or membership-scoped courses
- Whether SOAP is enabled for an authenticated student or service account
- DOM selectors for a production HTML parser
- File download permission behavior
- German/English label parity beyond the language switcher existing on public pages

## Follow-up visual checks (need a student session or admin)

1. Dashboard course cards and semester filters
2. Course page text plus folders, including empty folders
3. File row metadata (size, pages, access class, author)
4. News items that name course + folder
5. Calendar entries vs page-embedded dates
6. MCP Inspector against `npm start` (fixture server; no ADAM required)
