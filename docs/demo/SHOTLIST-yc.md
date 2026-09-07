# YC demo shot list — marketing cut v2

**Duration:** ~92.5 s · **Format:** 1920×1080 · **Master:** [adam-mcp-demo-yc.mp4](adam-mcp-demo-yc.mp4)

Live Act A (Course Member session) hard-cut into fixture Act B (AI chat shell). Continuous VO + ducked music bed. Stitch notes: [STITCH-yc.md](STITCH-yc.md).

## Arc

| Beat | Picture | Notes |
| --- | --- | --- |
| Title | Dark title card | Music bed only |
| Act A — ADAM pain | Live dashboard → course → empty folders → calendar | Overlay: live session · empty inventory is honest |
| Bridge | Hard cut into chat | Same VO arc |
| Act B — chat | Assist demo shell; NL → tool chips → fixture replies | Badges: fixture catalog / labeled synthetic |
| Trust + close | Local-first end card + GitHub CTA | Community tool · not a University product |

## Act A shots (live)

1. Dashboard establish
2. Multimedia Retrieval course
3. 03 - Course & Notes empty
4. 04 - Exercises empty
5. Dashboard
6. Analysis I empty
7. Dashboard / calendar

## Act B shots (chat UX — fixture)

1. Assist demo shell with adam-mcp connected (fixture demo badge)
2. “What changed…?” → `adam_list_news`
3. “What’s due?” → `adam_list_calendar`
4. “Find the Fourier reading…” → `adam_search` + `adam_read_page`
5. “Show me exercise 100021” → `adam_get_exercise` · labeled synthetic
6. Trust end card + GitHub CTA

## Honesty rails

- Act A: live empty inventory (not staged content)
- Act B: fixture / synthetic labels on screen; no live student data in chat replies
- No invented frm/sess/webr
- Community Uni Basel student tool; not a University product

## Rebuild

```bash
# Chat Act B shell (fixture answers baked in)
# open docs/demo/chat-demo/ then node record.mjs (see chat-demo/record.mjs)
#
# Full master is authored offline; do not commit out/, work/, raw.mp4, probe-*.png
```

Legacy Inspector Act B-only cut (superseded as marketing master): [adam-mcp-demo-yc-actb.mp4](adam-mcp-demo-yc-actb.mp4). Recorder for that path: `record-yc.mjs`.
