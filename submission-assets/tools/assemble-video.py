#!/usr/bin/env python3
"""
Assemble the demo video from the raw screen recording.

Steps, all deterministic and re-runnable:
  1. trim the lead-in so video time 0 == narration time 0;
  2. burn in subtitles built from the measured cue times (readable on any
     player, and the reason the video is legible even with the audio muted);
  3. mux the narration track;
  4. normalise to 1920x1080, H.264 + AAC, faststart.

Nothing here alters the pixels of the application footage beyond scaling and
the subtitle overlay; the recording itself is untouched.

Writes: <out>/chroma-demo.mp4
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

FFMPEG = None  # resolved in main


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-3000:])
        raise SystemExit(f"ffmpeg failed: {' '.join(args[:6])} ...")
    return r


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def wrap(text: str, width: int = 46):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= width:
            cur = f"{cur} {w}".strip()
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def build_srt(cues, out: Path, lead: float, max_lines: int = 2):
    """One SRT entry per up-to-`max_lines`-line chunk.

    A long cue is split across its own measured span, so the words stay on screen
    for as long as they were spoken instead of being dropped or clipped.
    """
    blocks = []
    n = 0
    for start, end, lines in iter_chunks(cues, lead, max_lines):
        n += 1
        blocks.append(f"{n}\n{srt_time(start)} --> {srt_time(end)}\n" + "\n".join(lines) + "\n")
    out.write_text("\n".join(blocks), encoding="utf-8")
    return out


def iter_chunks(cues, lead: float, max_lines: int = 2):
    """Yield (start, end, lines) with the cue's measured span split by length."""
    for c in cues:
        lines = wrap(c["text"])
        chunks = [lines[i:i + max_lines] for i in range(0, len(lines), max_lines)]
        total = sum(len(" ".join(ch)) for ch in chunks) or 1
        t0 = c["start"]
        span = max(1.2, c["end"] - c["start"])
        for ch in chunks:
            share = len(" ".join(ch)) / total
            start = max(0.0, t0 - lead)
            end = max(start + 0.9, t0 + span * share - lead)
            yield start, end, ch
            t0 += span * share


def ass_time(t: float) -> str:
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360_000)
    m, cs = divmod(cs, 6_000)
    s, cs = divmod(cs, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def build_ass(cues, out: Path, lead: float, max_lines: int = 2):
    """Write an ASS subtitle file with an explicit 1920x1080 canvas.

    Relying on ffmpeg to convert SRT leaves libass guessing the reference
    resolution, which renders the text several times too large. Declaring
    PlayResX/PlayResY here makes FontSize mean pixels at 1080p.
    """
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,40,&H00FFFFFF,&H000000FF,&H00101014,&H96000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    rows = []
    for start, end, lines in iter_chunks(cues, lead, max_lines):
        text = "\\N".join(lines)
        rows.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{text}")
    out.write_text(head + "\n".join(rows) + "\n", encoding="utf-8")
    return out


def make_overlays(d: Path, total: float):
    """Render the intro banner and the end card as transparent PNGs."""
    from PIL import Image, ImageDraw, ImageFont

    BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    W, H = 1920, 1080

    def card(lines, y, name):
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(img)
        fonts = [ImageFont.truetype(BOLD if i == 0 else REG, sz) for i, (_, sz) in enumerate(lines)]
        pad, gap = 34, 16
        widths, heights = [], []
        for (text, _), f in zip(lines, fonts):
            bb = dr.textbbox((0, 0), text, font=f)
            widths.append(bb[2] - bb[0])
            heights.append(bb[3] - bb[1])
        bw = max(widths) + pad * 2
        bh = sum(heights) + gap * (len(lines) - 1) + pad * 2
        x0 = (W - bw) // 2
        dr.rounded_rectangle([x0, y, x0 + bw, y + bh], radius=18,
                             fill=(9, 10, 15, 226), outline=(90, 96, 112, 255), width=2)
        cy = y + pad
        for (text, _), f, w, h in zip(lines, fonts, widths, heights):
            dr.text((x0 + (bw - w) // 2, cy), text, font=f, fill=(245, 246, 250, 255))
            cy += h + gap
        p = d / name
        img.save(p)
        return p

    title = card(
        [("Chroma", 60), ("YouCam Skin Tone Analysis + Makeup Virtual Try-On", 30)], 196, "title.png")
    end = card(
        [("chroma-r8sd.vercel.app", 46), ("github.com/itzebe/chroma", 30)],
        742, "end.png")
    return title, end


def main() -> int:
    global FFMPEG
    FFMPEG = shutil.which("ffmpeg") or _imageio_ffmpeg()
    d = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/chroma-demo")
    raw = d / "raw.mp4"
    narr = d / "narration" / "narration.wav"
    cues_f = d / "narration" / "cues.json"
    ms_f = d / "milestones.json"
    for f in (raw, narr, cues_f, ms_f):
        if not f.exists():
            raise SystemExit(f"missing {f}")

    ms = json.loads(ms_f.read_text())
    lead = float(ms.get("lead", 0.4))
    cues = json.loads(cues_f.read_text())
    srt = build_srt(cues, d / "chroma-demo.srt", lead)
    ass = build_ass(cues, d / "chroma-demo.ass", lead)
    print(f"subtitles: {len(cues)} cues -> {srt.name} + {ass.name}")

    total = probe_duration(narr)
    title_png, end_png = make_overlays(d, total)
    print(f"overlays: {title_png.name}, {end_png.name} (total {total:.1f}s)")

    end_from = max(0.0, total - 4.8)
    fc = (
        f"[0:v]scale=1920:1080:flags=lanczos,ass={ass}[base];"
        f"[base][2:v]overlay=0:0:enable='between(t,0.3,5.4)'[v1];"
        f"[v1][3:v]overlay=0:0:enable='gte(t,{end_from:.2f})'[v]"
    )
    out = d / "chroma-demo.mp4"
    run([
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{lead}", "-i", str(raw),
        "-i", str(narr),
        "-loop", "1", "-framerate", "30", "-i", str(title_png),
        "-loop", "1", "-framerate", "30", "-i", str(end_png),
        "-filter_complex", fc,
        "-map", "[v]", "-map", "1:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-t", f"{total:.3f}",
        "-movflags", "+faststart",
        str(out),
    ])
    dur = probe_duration(out)
    print(f"\nwrote {out}")
    print(f"duration: {dur:.2f}s ({int(dur//60)}:{dur%60:04.1f})")
    return 0


def probe_duration(p: Path) -> float:
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", str(p)], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        if "Duration" in line:
            ts = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = ts.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0


def _imageio_ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


if __name__ == "__main__":
    raise SystemExit(main())
