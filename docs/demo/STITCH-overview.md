# Overview production notes

Rebuilt 20 October 2026. The [overview](adam-mcp-overview.mp4) uses H.264 video, AAC narration, 1920×1080 resolution and 24 frames per second. Duration is approximately 107.5 seconds. [Captions](overview.srt) and [narration](narration-v2.txt) are generated alongside it.

The source is [render-overview.py](render-overview.py): eight designed scenes rendered with Pillow, then encoded with ffmpeg. Each segment starts with a short fade and an illustrated response reveal. Speech uses `en-US-BrianNeural` at -3%; segment timing follows the generated audio, with a short reading pause. No stock music, external imagery, live student data or browser profile is used.

The paper/green visual system uses Georgia display text and Calibri body text, available from the rendering machine's licensed Windows installation. The video contains rendered text; font files are not distributed. Synthetic-data and unofficial-project disclosures remain visible. The final workflow and UI are illustrations, not an installed-client certification.

Intermediates live under ignored `work-rebuild/`, including per-scene PNGs, public narration scripts, synthesized audio, encodes and render evidence. `EDGE_TTS_BIN` selects the speech generator. Narration caches are keyed by text, voice and rate so revised scripts automatically generate fresh audio. Review the rendered output after every script or visual change.

The [Inspector revoice helper](revoice-inspector.py) separately replaces legacy audio and captions over existing synthetic Inspector footage. It preserves its original input in the ignored working directory for reproducible edits. That export is 54.6 seconds; it is independent of the overview timeline.

Verification: both exports were decoded, checked for video/audio streams and duration, and visually sampled for framing, text fit and synthetic-data disclosures. The overview speech peak measured below clipping. This review does not certify all future renders, real-client behavior or any earlier live footage.
