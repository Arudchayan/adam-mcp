# Demo

[Watch the overview](adam-mcp-overview.mp4) (approximately 93 seconds).

The video introduces the ADAM MCP workflow with an ADAM session recording followed by a simulated assistant conversation. The chat uses synthetic course data and scripted replies; it is not a recording of a supported client running the server.

| Segment | Source | Purpose |
| --- | --- | --- |
| ADAM navigation | Recorded signed-in course view | Show the navigation involved in finding course materials |
| Assistant conversation | Demo interface with synthetic fixture replies | Illustrate course news, deadlines, search, and an approved text read |

ADAM MCP is an unofficial community project. Sign-in takes place in a dedicated local Chrome profile. Returned text is shared with the model provider selected in the student's client.

## Recordings

| File | Contents |
| --- | --- |
| [adam-mcp-overview.mp4](adam-mcp-overview.mp4) | Overview with narration |
| [adam-mcp-inspector.mp4](adam-mcp-inspector.mp4) | Inspector walkthrough using synthetic course data |
| [adam-mcp-demo.mp4](adam-mcp-demo.mp4) | Earlier silent Inspector walkthrough |
| [demo.gif](demo.gif) | Short preview used in the project README |

## Production sources

- [Overview shot list](SHOTLIST-overview.md)
- [Overview production notes](STITCH-overview.md)
- [Chat interface and recording script](chat-demo/)
- [Narration](narration-v2.txt)

`npm run demo` serves the Inspector demo. `npm run demo:record` records that interface; `npm run demo:record:inspector` records the narrated Inspector walkthrough. These production helpers require their own browser, video, and optional speech tooling; they are not part of the npm package or installation checks.

For narration in the Inspector recording, set `EDGE_TTS_BIN` to the installed `edge-tts` executable. Without it, the script produces a silent recording with subtitles.

Review every recording for personal information and third-party course content before sharing a release. Rebuilding the npm CLI does not validate the video frames or audio. Intermediate captures and generated working files must remain untracked.

Narration scripts and interface copy were revised on 20 October 2026. Existing video exports retain their original audio and captions until rebuilt and reviewed; the source edits do not certify those exports for publication.
