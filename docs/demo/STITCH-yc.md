# YC demo stitch notes — v2

**Output:** `docs/demo/adam-mcp-demo-yc.mp4`  
**Format:** 1920x1080 H.264 + AAC stereo · **92.5 s** · ~5.6 MiB

## What changed vs v1

| | v1 | v2 |
| --- | --- | --- |
| Act B UI | MCP Inspector / raw tool execute | AI chat shell (Assist demo) with NL Q→A |
| VO | Split: short Act A VO then Act B cold-open restart | One continuous narration arc (4 paced clips) |
| Music | None | Synthesized upbeat lo-fi bed; sidechain-ducked ~18 dB under VO |
| Honesty | Fixture label on Inspector title | Badges + per-reply fixture/synthetic tags + footer disclaimer |
| Total | ~97.1 s | **92.5 s** |

## Timeline

| Segment | Source | Duration | Notes |
| --- | --- | --- | --- |
| Unified title | generated | 3.0 s | adam-mcp / twenty clicks… |
| Act A | live ADAM session trims | 39.5 s | Same useful ranges as v1; scaled/padded 1280×800 → 1920×1080 |
| Act B | Playwright record of `chat-demo/` | 50.0 s | ~40.9 s live chat + freeze pad on end card |
| **Total** | hard-cut concat | **92.5 s** | In 90–110 s band |

### Act A trim (from live capture)

1. Dashboard (~4.0–8.5)
2. Multimedia Retrieval course (~15.0–22.5)
3. 03 - Course & Notes empty (~29.5–36.0)
4. 04 - Exercises empty (~49.5–56.0)
5. Dashboard (~63.5–66.5)
6. Analysis I empty (~75.0–82.0)
7. Dashboard / calendar (~86.0–90.5)

### Act B chat beats (fixture answers baked from `createFixtureProvider`)

1. Connect establish
2. News → `adam_list_news` (2 enrolled news items)
3. Due → `adam_list_calendar` (calendar + exc + page aggregates; URLs real `adam.unibas.ch/go/...`)
4. Fourier → `adam_search` + `adam_read_page` on crs 100001
5. Exercise 100021 labeled synthetic
6. Trust + GitHub end card

## Audio

- Script: `docs/demo/narration-v2.txt`
- Clips: `work-v2/audio/vo_{a,bridge,b,close}.mp3` (en-US-BrianNeural +5%)
- Placement: vo_a @ 3.5s · bridge @ 40s · vo_b @ 48s · close @ 80s
- Music: `work-v2/audio/music-bed.wav` (ffmpeg sine/noise lo-fi bed; no third-party stock)
- Mix: sidechain duck under VO; VO clear over bed

## Honesty rails

- Act A: live Course Member session; empty inventory is honest — not staged fake empty, not a contentful study-week walk
- Act B: fixture provider; on-screen **fixture catalog** / **labeled synthetic** / footer disclaimer
- Not a University product; local-first; no cloud tunnel of SWITCH login
- No invented frm/sess/webr; no Inspector footage reused

## Rebuild crumbs

- Chat UI: `docs/demo/chat-demo/` (`index.html`, `styles.css`, `app.js`, `record.mjs`)
- Fixture bake: `chat-demo/fixture-answers.json` via `adam-provider-fixture`
- Intermediates (do **not** commit): `out/`, `work/`, `raw.mp4`, `probe-*.png`, `venv/`, `*.log`
- Packaged for docs(demo) PR
