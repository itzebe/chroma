# Demo video

`chroma-demo.mp4` — 2:33 (152.9s), 1920×1080, H.264/AAC.

## What the video shows

A single, unedited run of the **deployed** application at
<https://chroma-r8sd.vercel.app/>. The two moments that matter are real network
calls to the YouCam API, made by the production deployment during the recording:

| Time | What happens | API call |
| --- | --- | --- |
| 0:32 | "Measure my skin colours" is pressed | `POST /s2s/v2.0/task/skin-tone-analysis` (20 units) |
| 0:41 | Measured colours appear, labelled "measured live just now" | — |
| 1:32 | "Render the Evening look" is pressed | `POST /s2s/v2.0/task/makeup-vto` (1 unit) |
| 1:41 | The composited image appears | — |

The recording is a real browser session (the URL bar shows the production host).
Nothing is mocked, staged, or composited: the driver script only scrolls, clicks
and waits, exactly as a person would. There is no cut, no speed change, and no
frame replacement.

## How it was produced

Reproducible with the scripts in `../tools/`:

```bash
# 1. narration audio + measured scene timings + subtitle cues
python3 ../tools/build-narration.py out/narration

# 2. drive the deployed app on a virtual display and record the screen
DEMO_MODE=live OUT=out ../tools/record-demo.sh     # 21 API units
#   DEMO_MODE=recorded OUT=out ../tools/record-demo.sh   # 0 units, pipeline check

# 3. trim, burn subtitles, mux narration, add title/end cards
python3 ../tools/assemble-video.py out
```

Scene pacing is not guessed: `build-narration.py` measures the spoken length of
each scene and writes `timings.json`, which `record-demo.mjs` uses to place each
scene's actions. The footage and the voice track therefore line up by
construction.

## Audio and subtitles

The voice is synthetic (`espeak-ng`), used as an accessibility aid. The same
words are burned into the video as subtitles from the measured cue times
(`chroma-demo.srt` and `chroma-demo.ass`, also provided separately), so the demo
is fully legible with the sound off. Long lines are wrapped to two lines per
caption. No third-party music or trademarks are used.

## Photo

The photo analysed in the video is the sample asset the YouCam documentation uses
for the skin tone analysis endpoint
(`bcw-media.s3.ap-northeast-1.amazonaws.com/img_Face_Ratio_sec_02_02_enu_21a3d8d423.jpg`,
MD5 `50f25e24e3268f2d96f886995dcc6f8d`). It is the vendor's own published
example image, not a private individual's photo.
