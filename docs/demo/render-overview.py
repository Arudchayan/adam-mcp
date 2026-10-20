"""Render a narrated, synthetic product walkthrough. No account or live ADAM data.

Requires Python with Pillow, ffmpeg/ffprobe, and EDGE_TTS_BIN (edge-tts).
Intermediates stay in ignored work-rebuild/. No media is part of the npm package.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import textwrap

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work-rebuild"
BG, INK, MUTED = "#F4F1E9", "#173C34", "#536B63"
GREEN, LINE, WHITE = "#25654E", "#D7DED4", "#FFFEF9"
FONT_DIR = Path(os.environ.get("DEMO_FONT_DIR", "C:/Windows/Fonts"))
FONTS = {"body": "calibri.ttf", "bold": "calibrib.ttf", "display": "georgia.ttf"}

SCENES = [
    ("Your courses.\nA clearer starting point.", "ADAM MCP connects your University of Basel courses to an MCP-compatible assistant. Here is one study workflow, illustrated with synthetic course data.", "intro"),
    ("Start with\nyour courses.", "Sign in through a dedicated Chrome session. Ask for your courses, then choose the one you want to explore. Course links take you back to ADAM.", "courses"),
    ("Know what\nneeds attention.", "Ask for available deadlines in that course. Results cite their source. If a listing is incomplete, the assistant should say so. An empty folder does not mean there are no deadlines.", "deadlines"),
    ("Find the material.\nKeep the source.", "Search your enrolled course tree for a topic, such as Fourier transforms. Search covers titles and available page text. It is not ADAM's global search.", "search"),
    ("Choose what\nyou share.", "Select a page and approve the read. Page text, file extracts, exercise instructions, and forum posts require approval for the selected object. Declining returns no body text.", "approval"),
    ("Read with\ncontext.", "The assistant can work with the approved text and cite its ADAM link. Extracts are bounded. Scanned PDFs have no OCR, and mathematical notation may need checking in the original.", "read"),
    ("Local connection.\nClear boundaries.", "The server runs on your machine. Sign-in stays in Chrome. Returned text goes to the model provider chosen in your client. Exams, grades, submissions, and other writes are unsupported.", "privacy"),
    ("Make room\nfor studying.", "Explore the setup guide and client compatibility notes in the repository. ADAM MCP is an unofficial, open-source community project. This illustration does not certify a client integration.", "close"),
]


def font(size, kind="body"):
    return ImageFont.truetype(str(FONT_DIR / FONTS[kind]), size)


def run(args):
    subprocess.run([str(a) for a in args], check=True)


def wrap(draw, text, size, max_width, kind="body"):
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font(size, kind)) > max_width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    return "\n".join([*lines, current])


def render(index, state=1):
    title, narration, kind = SCENES[index]
    image = Image.new("RGB", (1920, 1080), BG)
    d = ImageDraw.Draw(image)
    def text(x, y, value, size=28, color=INK, style="body"):
        d.multiline_text((x, y), value, font=font(size, style), fill=color, spacing=12)
    def rule(x, y, x2, color=LINE):
        d.line((x, y, x2, y), fill=color, width=2)
    def card(y, title, detail, tag=None):
        d.rounded_rectangle((876, y, 1766, y + 126), radius=12, fill=WHITE, outline=LINE, width=2)
        text(906, y + 21, title, 30, style="bold")
        text(906, y + 71, detail, 24, MUTED)
        if tag:
            text(1630, y + 25, tag, 22, GREEN, "bold")
    text(88, 50, "ADAM / MCP", 29, style="bold")
    text(1220, 55, "WORKFLOW ILLUSTRATION  /  SYNTHETIC DATA", 22, MUTED, "bold")
    rule(88, 108, 1832)
    text(88, 192, f"{index + 1:02d}  /  THE STUDY WORKFLOW", 23, GREEN, "bold")
    text(82, 264, title, 68, style="display")
    descriptions = {
        "intro": "Course context, available deadlines,\nand approved text — with ADAM links.",
        "courses": "A familiar question.\nA source you can return to.",
        "deadlines": "Sources and coverage matter\nas much as the answer.",
        "search": "Narrow the search to a course.\nFollow the result back to ADAM.",
        "approval": "One selected object.\nAn explicit decision before sharing.",
        "read": "Useful text, a clear citation,\nand the limits in view.",
        "privacy": "Understand where sign-in happens\nand where returned text goes.",
        "close": "Read the setup guide.\nCheck your client's verification status.",
    }
    text(88, 495, descriptions[kind], 32, MUTED)
    if kind not in ("intro", "privacy", "close"):
        d.rounded_rectangle((832, 184, 1810, 840), radius=18, fill="#E9EEE6", outline=LINE, width=2)
        text(876, 216, "ADAM study workspace", 30, style="bold")
        text(876, 263, "Illustrated assistant  ·  Synthetic course data", 23, MUTED)
        rule(876, 311, 1766)
        prompts = {"courses": "Which courses am I in?", "deadlines": "What is due in this course?", "search": "Find the Fourier reading.", "approval": "Read this selected course page.", "read": "Explain the selected reading."}
        text(876, 338, prompts[kind], 32, style="bold")
        if state:
            if kind == "courses":
                card(421, "Multimedia Seminar", "Course 100001  ·  Open in ADAM", "COURSE")
                card(565, "Foundations of Analysis", "Course 100101  ·  Open in ADAM", "COURSE")
                text(906, 736, "Choose a course to focus the next request.", 25, MUTED)
            elif kind == "deadlines":
                card(421, "Exercise 1 · Retrieval summary", "22 September 2026  ·  Source: exercise 100021", "DUE")
                card(565, "Lab sheet 1 · Sorting warm-up", "5 October 2026  ·  Source: exercise 100121", "DUE")
                text(906, 736, "Illustration: available results; check coverage notices.", 24, MUTED)
            elif kind == "search":
                card(421, "Fourier transforms and the DFT", "Match in available page text  ·  Course 100001", "PAGE")
                text(906, 595, "https://adam.unibas.ch/go/crs/100001", 27, GREEN)
                text(906, 683, "Next: select the page and request an approved read.", 25, MUTED)
            elif kind == "approval":
                text(906, 427, "Share text from this selected page?", 32, style="bold")
                text(906, 489, "Course 100001 · Multimedia Seminar", 27)
                text(906, 543, "Returned text goes to your client's model provider.", 25, MUTED)
                d.rounded_rectangle((906, 625, 1287, 696), radius=8, fill=GREEN)
                text(934, 642, "Approve selected read", 27, WHITE, "bold")
                text(1360, 643, "Decline", 27)
                text(906, 749, "Illustrated decision; client approval UI may differ.", 23, MUTED)
            else:
                text(906, 420, "Fourier transforms", 34, style="bold")
                text(906, 483, "The selected page introduces the DFT and", 29)
                text(906, 528, "points to the assigned reading for this week.", 29)
                rule(906, 606, 1726)
                text(906, 636, "Source · Course page 100001", 26, GREEN, "bold")
                text(906, 687, "Check formulas and layout in the original material.", 25, MUTED)
                text(906, 754, "Synthetic summary · not a live model response", 23, MUTED)
    elif kind == "intro":
        for y, number, label, sub in [(253, "01", "Find your context", "Courses, materials, ADAM links"), (433, "02", "Choose an approved read", "The selected object, with your approval"), (613, "03", "Keep the limits visible", "Sources, coverage and sharing")]:
            text(880, y, number, 29, GREEN, "bold")
            text(966, y - 6, label, 36, style="bold")
            text(966, y + 54, sub, 27, MUTED)
            rule(880, y + 123, 1795)
    elif kind == "privacy":
        for y, label, sub in [(236, "Your MCP client", "Receives tool results and sends them to its model provider"), (433, "ADAM MCP · on your machine", "Read-only tools through a dedicated Chrome session"), (630, "University of Basel ADAM", "Sign in in Chrome; never send passwords to the assistant")]:
            text(880, y, label, 36, style="bold")
            text(880, y + 65, wrap(d, sub, 27, 860), 27, MUTED)
            rule(880, y + 150, 1795)
    else:
        text(880, 275, "ADAM MCP", 75, style="display")
        text(880, 402, "Open source · GPL-3.0-or-later", 30, MUTED)
        rule(880, 490, 1795)
        text(880, 535, "github.com/Arudchayan/adam-mcp", 33, GREEN, "bold")
        text(880, 621, "Setup guide  /  Client compatibility  /  Limitations", 26, MUTED)
        text(880, 733, "Unofficial University of Basel community project", 25, MUTED)
    # A restrained progress rail and persistent disclosure frame every scene.
    for i in range(8):
        d.rectangle((88 + i * 84, 748, 148 + i * 84, 753), fill=GREEN if i <= index else LINE)
    rule(88, 900, 1832)
    text(88, 930, wrap(d, narration, 28, 1735), 28)
    text(88, 1030, "UNOFFICIAL COMMUNITY PROJECT", 20, MUTED, "bold")
    text(1140, 1030, "Synthetic data · Scripted replies · No live student information", 20, MUTED)
    return image


def stamp(seconds):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames-only", action="store_true")
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    for i in range(len(SCENES)):
        render(i).save(WORK / f"scene-{i}.png")
        render(i, 0).save(WORK / f"scene-{i}-waiting.png")
    if args.frames_only:
        return
    tts = os.environ.get("EDGE_TTS_BIN")
    if not tts:
        raise RuntimeError("Set EDGE_TTS_BIN; a narrated export must not silently fall back to silence.")
    cues, durations, cursor = [], [], 0.0
    for i, (_, narration, _) in enumerate(SCENES):
        script = WORK / f"scene-{i}.txt"
        script.write_text(narration, encoding="utf-8")
        fingerprint = hashlib.sha256(("BrianNeural|-3%|" + narration).encode()).hexdigest()[:12]
        audio = WORK / f"scene-{i}-{fingerprint}.mp3"
        if not audio.exists():
            run([tts, "--voice", "en-US-BrianNeural", "--rate=-3%", "-f", script, "--write-media", audio])
        duration = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(audio)], text=True)) + 1.25
        durations.append(duration)
        cues.append(f"{i + 1}\n{stamp(cursor)} --> {stamp(cursor + duration)}\n{textwrap.fill(narration, 88)}\n")
        cursor += duration
        # The response appears after a brief reading pause; tool state is illustrative.
        video = WORK / f"scene-{i}.mp4"
        filters = f"[0:v][1:v]overlay=enable='gte(t,1.3)',fade=t=in:st=0:d=0.3,fade=t=out:st={duration - .3}:d=0.3,format=yuv420p[v];[2:a]adelay=350:all=1,apad[a]"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", WORK / f"scene-{i}-waiting.png", "-loop", "1", "-i", WORK / f"scene-{i}.png", "-i", audio, "-filter_complex", filters, "-map", "[v]", "-map", "[a]", "-t", duration, "-r", "24", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", video])
    listing = WORK / "overview-concat.txt"
    listing.write_text("\n".join(f"file 'scene-{i}.mp4'" for i in range(8)), encoding="utf-8")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", "-movflags", "+faststart", ROOT / "adam-mcp-overview.mp4"])
    (ROOT / "overview.srt").write_text("\n".join(cues), encoding="utf-8")
    (ROOT / "narration-v2.txt").write_text("\n\n".join(scene[1] for scene in SCENES) + "\n", encoding="utf-8")
    (WORK / "render-evidence.json").write_text(json.dumps({"duration": cursor, "sceneDurations": durations, "voice": "en-US-BrianNeural", "data": "synthetic; scripted illustration; no live browser capture"}, indent=2), encoding="utf-8")
    print(f"Rendered narrated overview: {cursor:.1f}s, 1920x1080, eight scenes.")


if __name__ == "__main__":
    main()
