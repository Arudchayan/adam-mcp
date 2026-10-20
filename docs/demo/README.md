# Demo

[Watch the overview](adam-mcp-overview.mp4) (approximately 108 seconds).

The overview illustrates a study workflow: choose a course, check available deadlines, find material, approve a selected read, and keep sources and limitations visible. Its course names, dates, responses and approval interface are synthetic illustrations. It is not a recording of an installed client connected to live ADAM.

The visual design uses a warm paper background, green accents, large text, a chapter rail and persistent synthetic-data disclosure. Narration uses synthesized speech; full captions remain visible. No live account, course document, student name, password or browser profile is used in the new overview.

| File | Contents |
| --- | --- |
| [adam-mcp-overview.mp4](adam-mcp-overview.mp4) | New narrated eight-scene illustration, 1920×1080, approximately 108 seconds |
| [overview.srt](overview.srt) | Overview narration captions |
| [adam-mcp-inspector.mp4](adam-mcp-inspector.mp4) | Retained synthetic Inspector footage with replacement narration, title and visible captions; 54.6 seconds |
| [narration.srt](narration.srt) | Inspector narration captions |
| [adam-mcp-demo.mp4](adam-mcp-demo.mp4) | Earlier silent Inspector walkthrough |
| [demo.gif](demo.gif) | Preview from the new overview |

## Rebuild the current exports

Requires Python with Pillow, ffmpeg/ffprobe, and an `edge-tts` installation. Set `EDGE_TTS_BIN` to that executable. Rendering does not require ADAM access. The default fonts are Georgia and Calibri from Windows; set `DEMO_FONT_DIR` to a directory containing those licensed fonts when reproducing elsewhere. Font files are not redistributed.

```powershell
$env:EDGE_TTS_BIN = 'C:/path/to/edge-tts.exe'
python docs/demo/render-overview.py
python docs/demo/revoice-inspector.py
```

The overview renderer creates its scenes from source. The Inspector helper preserves its input in ignored `work-rebuild/inspector/source.mp4` on first run, then replaces audio, title and bottom captions. Preserve that intermediate source when iterating. Speech synthesis sends only the public synthetic narration to Microsoft's speech service. The current export uses `en-US-BrianNeural`; intermediate audio is untracked. A missing voice generator fails the render instead of silently producing an unnarrated export.

The earlier browser/chat recording helpers remain available for reference. They are not the production path for the current overview. See [shot list](SHOTLIST-overview.md) and [production notes](STITCH-overview.md).

ADAM MCP is unofficial. Authentication stays in a dedicated Chrome session; returned tool text goes to the model provider selected in the student's client. Synthetic demonstrations do not establish real-client compatibility. Review any future captures for personal information and redistribution rights before sharing. Media and production helpers are excluded from the npm tarball.
