"""Replace legacy Inspector narration/captions while retaining synthetic footage.

Run once with the legacy MP4, then retain it in ignored work-rebuild/ as input.
Requires Pillow, ffmpeg/ffprobe, and EDGE_TTS_BIN. Never uses a signed-in profile.
"""
import os
import hashlib
from pathlib import Path
import shutil
import subprocess
import runpy

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
helpers = runpy.run_path(str(ROOT / "render-overview.py"))
font, stamp = helpers["font"], helpers["stamp"]
WORK = ROOT / "work-rebuild" / "inspector"
CUES = [
    (0, 5, "ADAM MCP in the MCP Inspector. This walkthrough uses synthetic course data."),
    (5, 13, "List course news, with source links. This is a fixture demonstration, not a live course inventory."),
    (13, 23, "List courses and available deadlines. Results should retain their source and report incomplete coverage."),
    (23, 33, "Search the enrolled course tree. Approve a selected page read before its text is returned."),
    (33, 40.5, "Read selected exercise instructions after approval. The server cannot submit work."),
    (40.5, 49, "Sign-in stays in Chrome. Returned text goes to the model provider chosen in your client."),
    (49, 54.6, "An unofficial community project. Find setup and limitations in the repository."),
]


def run(args):
    subprocess.run([str(a) for a in args], check=True)


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    source = WORK / "source.mp4"
    if not source.exists():
        shutil.copyfile(ROOT / "adam-mcp-inspector.mp4", source)
    title = Image.new("RGB", (1920, 1080), "#F4F1E9")
    d = ImageDraw.Draw(title)
    d.text((130, 205), "ADAM MCP", font=font(96, "display"), fill="#173C34")
    d.text((135, 380), "An Inspector walkthrough", font=font(48, "bold"), fill="#25654E")
    d.text((135, 490), "Synthetic course data. Read-only tools. Selected-object approval.", font=font(32), fill="#536B63")
    d.text((135, 710), "Unofficial University of Basel community project", font=font(29), fill="#536B63")
    title.save(WORK / "title.png")
    filters = ["[0:v][1:v]overlay=enable='lt(t,5)'", "drawbox=x=0:y=940:w=iw:h=140:color=0x173C34:t=fill"]
    cues = []
    for i, (start, end, narration) in enumerate(CUES):
        textfile = WORK / f"caption-{i}.txt"
        # Explicit wrapping avoids clipping long captions at 1080p.
        import textwrap
        textfile.write_text(textwrap.fill(narration, 104), encoding="utf-8")
        fingerprint = hashlib.sha256(("BrianNeural|+2%|" + narration).encode()).hexdigest()[:12]
        audio = WORK / f"voice-{i}-{fingerprint}.mp3"
        if not audio.exists():
            run([os.environ["EDGE_TTS_BIN"], "--voice", "en-US-BrianNeural", "--rate=+2%", "--text", narration, "--write-media", audio])
        duration = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(audio)], text=True))
        # Fit each utterance without truncating words or carrying into the next beat.
        rate = max(1, duration / (end - start - .2))
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", audio, "-af", f"atempo={rate},apad", "-t", end - start, "-ar", "48000", "-ac", "2", WORK / f"voice-{i}.wav"])
        # Use local relative paths for portable ffmpeg filter escaping.
        filters.append(f"drawtext=fontfile='C\\:/Windows/Fonts/calibri.ttf':textfile=caption-{i}.txt:fontcolor=0xFFFEF9:fontsize=32:x=60:y=962:line_spacing=10:enable='between(t,{start},{end})'")
        cues.append(f"{i + 1}\n{stamp(start)} --> {stamp(end)}\n{narration}\n")
    filters.append("drawtext=fontfile='C\\:/Windows/Fonts/calibrib.ttf':text='SYNTHETIC COURSE DATA':fontcolor=0xA9D0BA:fontsize=21:x=60:y=1050")
    (WORK / "filters.txt").write_text(",".join(filters) + "[v]", encoding="utf-8")
    (WORK / "audio-concat.txt").write_text("\n".join(f"file 'voice-{i}.wav'" for i in range(len(CUES))), encoding="utf-8")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", WORK / "audio-concat.txt", "-c:a", "pcm_s16le", WORK / "narration.wav"])
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "source.mp4", "-loop", "1", "-i", "title.png", "-i", "narration.wav", "-filter_complex_script", "filters.txt", "-map", "[v]", "-map", "2:a", "-t", "54.6", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(ROOT / "adam-mcp-inspector.mp4")], cwd=WORK, check=True)
    (ROOT / "narration.srt").write_text("\n".join(cues), encoding="utf-8")
    (ROOT / "narration.txt").write_text("\n\n".join(cue[2] for cue in CUES) + "\n", encoding="utf-8")
    print("Inspector narration and visible captions rebuilt; 54.6 seconds.")


if __name__ == "__main__":
    main()
