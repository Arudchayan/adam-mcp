# Overview production notes

The existing [overview](adam-mcp-overview.mp4) is a 92.5-second H.264 video with AAC stereo audio at 1920×1080. These notes describe its production sources; they do not certify the recording for release.

| Segment | Source | Duration |
| --- | --- | --- |
| Title | Generated title card | 3.0 seconds |
| ADAM navigation | Recorded signed-in dashboard and course views | 39.5 seconds |
| Assistant conversation | Browser recording of `chat-demo/` with scripted fixture replies | 50.0 seconds |

The ADAM segment visits Multimedia Retrieval, its notes and exercises folders, Analysis I, and the dashboard calendar. The conversation segment illustrates `adam_list_news`, `adam_list_calendar`, `adam_search`, `adam_read_page`, and `adam_get_exercise` using synthetic course data. Links use the canonical ADAM URL format; fixture IDs are not evidence of accessible live objects.

The chat source is in [chat-demo/](chat-demo/); narration is in [narration-v2.txt](narration-v2.txt). The original export used synthesized narration and a generated music bed with volume reduced under speech. Intermediate audio and captures are intentionally untracked.

Before exporting a new overview, use the current narration and privacy copy, retain visible synthetic-data labels, and review the result for personal information and rights to redistribute course content. Existing video exports retain their original narration until rebuilt and reviewed. No installed-client compatibility claim follows from this recording.
