#!/usr/bin/env python3
"""
Build the demo narration audio from NARRATION.md and report the real duration of
every scene, so the video is cut to measured timings rather than guessed ones.

Uses espeak-ng (a synthetic voice). This is an accessibility aid for the
recording: the video ships with burned-in subtitles carrying the same words, so
the content is legible whether or not the synthetic track is used.

Writes: <out>/scene-<n>.wav, <out>/narration.wav, <out>/timings.json
"""
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

VOICE = "en-us"
RATE = 172      # words per minute
PITCH = 45
GAP_MS = 260    # pause between sentences inside a scene

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent          # submission-assets/


def wav_seconds(path: Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / float(w.getframerate())


def say(text: str, out: Path) -> float:
    subprocess.run(
        ["espeak-ng", "-v", VOICE, "-s", str(RATE), "-p", str(PITCH), "-w", str(out), text],
        check=True,
    )
    return wav_seconds(out)


def silence(seconds: float, out: Path, rate: int = 22050) -> None:
    n = int(seconds * rate)
    with wave.open(str(out), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * n)


def parse(md: str):
    """Return [(scene_title, [('say', text) | ('pause', secs), ...]), ...]."""
    scenes = []
    for block in re.split(r"\n##\s+", md):
        if not block.strip():
            continue
        lines = block.strip().splitlines()
        title = lines[0].strip()
        if title.lower().startswith("s") and "—" in title:
            events = []
            buf = []
            for ln in lines[1:]:
                ln = ln.strip()
                m = re.fullmatch(r"\[\[pause ([\d.]+)\]\]", ln)
                if m:
                    if buf:
                        events.append(("say", " ".join(buf)))
                        buf = []
                    events.append(("pause", float(m.group(1))))
                elif not ln or ln == "---":
                    # a blank line ends the current paragraph => its own subtitle
                    if buf:
                        events.append(("say", " ".join(buf)))
                        buf = []
                else:
                    buf.append(ln)
            if buf:
                events.append(("say", " ".join(buf)))
            scenes.append((title, events))
    return scenes


def main() -> int:
    src = (ASSETS / "NARRATION.md").read_text(encoding="utf-8")
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/chroma-narration")
    out.mkdir(parents=True, exist_ok=True)

    scenes = parse(src)
    if not scenes:
        print("no scenes parsed", file=sys.stderr)
        return 1

    timings = []
    scene_wavs = []
    cues = []          # {start, end, text} per spoken line, real measured times
    t = 0.0
    for i, (title, events) in enumerate(scenes, start=1):
        parts = []
        scene_start = t
        for kind, val in events:
            if kind == "say":
                p = out / f"_s{i}_line{len(parts)}.wav"
                dur = say(val, p)
                parts.append(p)
                cues.append({"start": round(t, 2), "end": round(t + dur, 2), "text": val})
                t += dur
                gap = out / f"_s{i}_gap{len(parts)}.wav"
                silence(GAP_MS / 1000.0, gap)
                parts.append(gap)          # keep scene spans contiguous
                t += GAP_MS / 1000.0
            else:
                p = out / f"_s{i}_gap{len(parts)}.wav"
                silence(val, p)
                parts.append(p)
                t += val
        # assemble this scene
        scene_wav = out / f"scene-{i:02d}.wav"
        with wave.open(str(parts[0])) as w0:
            rate, ch, width = w0.getframerate(), w0.getnchannels(), w0.getsampwidth()
        with wave.open(str(scene_wav), "w") as wout:
            wout.setnchannels(ch)
            wout.setsampwidth(width)
            wout.setframerate(rate)
            for p in parts:
                with wave.open(str(p)) as w:
                    wout.writeframes(w.readframes(w.getnframes()))
        scene_wavs.append(scene_wav)
        timings.append({
            "scene": i,
            "title": title,
            "start": round(scene_start, 2),
            "duration": round(wav_seconds(scene_wav), 2),
        })
        for p in parts:
            p.unlink()

    # full narration
    full = out / "narration.wav"
    with wave.open(str(scene_wavs[0])) as w0:
        rate, ch, width = w0.getframerate(), w0.getnchannels(), w0.getsampwidth()
    with wave.open(str(full), "w") as wout:
        wout.setnchannels(ch)
        wout.setsampwidth(width)
        wout.setframerate(rate)
        for p in scene_wavs:
            with wave.open(str(p)) as w:
                wout.writeframes(w.readframes(w.getnframes()))

    total = wav_seconds(full)
    (out / "timings.json").write_text(
        json.dumps({"total": round(total, 2), "scenes": timings}, indent=2), encoding="utf-8"
    )
    (out / "cues.json").write_text(json.dumps(cues, indent=2), encoding="utf-8")
    for s in timings:
        print(f"  S{s['scene']:02d}  {s['start']:6.2f}s  +{s['duration']:5.2f}s  {s['title']}")
    print(f"\ntotal narration: {total:.2f}s ({int(total//60)}:{total%60:04.1f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
