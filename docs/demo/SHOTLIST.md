# Demo shot list

Duration: **about 57s**. 1920×1080. Silent. Bottom caption bar, Segoe UI. Fixture catalog through the real `adam-mcp` stdio server, shown in MCP Inspector.

No title card, no serif headlines, no fake Cursor chrome.

## Prompts / actions

1. “What changed in my ADAM courses this week?” → `adam_list_news`
2. Chrome: `https://adam.unibas.ch/login.php` (no sign-in)
3. `adam_list_courses` then `adam_list_calendar`
4. “Find the Fourier reading. Summarize the course page.” → `adam_search` `{ "query": "Fourier" }` then `adam_read_page` `{ "refId": "100001", "confirm": true }`
5. GitHub: `https://github.com/Arudchayan/adam-mcp` (header / file tree; ~4s)

## Captions

| Clip | Caption |
| --- | --- |
| News | What changed in my ADAM courses this week? |
| Chrome | Uses your local ADAM browser session. |
| Courses | Courses and deadlines, with ADAM URLs. |
| Search / page | Find the Fourier reading. Summarize the course page. |
| GitHub | github.com/Arudchayan/adam-mcp |

## Narration (optional, not in the file)

> I built ADAM MCP so I could use the AI tools I already work with on my ADAM courses. It runs locally and talks to ADAM through MCP — courses, pages, files, deadlines. Sign in in Chrome, then ask your client what’s due or what changed.

## Visual rules

- Real Inspector, real Chrome, real GitHub.
- One caption: white on `#111`, Segoe UI, ~28px, bottom bar.
- No progress lines, page numbers, or mock tool cards.

## Record

```bash
npm run build
npm run demo:record
```
