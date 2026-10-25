# Chroma

Skin intelligence and virtual try-on, built on the YouCam API.

A person uploads one selfie. The YouCam Skin AI measures the actual colours on
their face. Those measurements become a seasonal colour profile, and from that
profile the app **computes** makeup looks, judges whether a garment colour works
on them, and ranks product shades against their own skin.

Built for the **YouCam API Skin AI & eCommerce VTO Hackathon**.

---

## The one test every feature had to pass

> **Would this work the same without the YouCam API?**

If the answer was yes, the feature was cut. That single question is what
separates this from a colour-analysis wrapper with an API call bolted on:

| Feature | Why it needs YouCam |
| --- | --- |
| Measured colours | Skin, lip, eye and brow hex values are read from the photo. Nothing asks the user to self-report their undertone. |
| Computed looks | The makeup engine accepts arbitrary hex colours, so every look is derived from the measured palette by explicit Lab transformations. Each transformation is printed on screen. |
| Real render | The makeup VTO endpoint composites those computed colours onto the user's actual photo. |
| Grounded shopping advice | Garment verdicts and shade rankings are perceptual distances from the measured colours, not a static chart. |

The whole product is therefore downstream of one API call. Change the photo and
every number on the page changes with it.

## What it does

Five steps, in order:

1. **Measured** — the raw YouCam skin tone analysis output: four measured hex
   values with their L\*C\*h° coordinates, plus the quality checks the API
   returned (face found, face size, frontal, lighting, head pose).
2. **Interpreted** — a seasonal colour profile (spring / summer / autumn /
   winter, light / bright / soft / deep). Every axis is scored independently and
   the runners-up are shown, so the user can see how clear-cut the result was.
3. **Generated** — three makeup looks (everyday, signature, evening). Colours
   are computed from the measured palette, not picked from a preset list.
4. **Shopping** — a garment colour checker: paste any hex or pick a swatch and
   get a CIEDE2000 verdict against the palette, plus the nearest colours to buy
   instead.
5. **Shades** — foundation, lipstick, blush and eye shadow ranked against the
   colour actually measured on the face.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in YOUCAM_API_KEY
npm run dev                  # http://localhost:3000
```

Without a key the UI still loads, but analysis and rendering are unavailable.
The **Recorded sample** button replays a captured live API response, so the
whole interface can be explored and judged without spending API units.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `YOUCAM_API_KEY` | yes | Server-side only. Never sent to the browser. |
| `YOUCAM_API_BASE_URL` | no | Defaults to `https://yce-api-01.makeupar.com`. |

The key is read from the environment at call time. It is never logged, never
included in a response, and never written to a file in this repository.

## Commands

```bash
npm run dev        # development server
npm run build      # production build
npm test           # unit tests (node --test)
npm run typecheck  # tsc --noEmit
npm run verify     # tests, then typecheck, then build
```

## Architecture

```
src/lib/youcam.ts     YouCam API client: file upload, task polling, errors
src/lib/color.ts      colour science: sRGB <-> Lab <-> LCh, CIEDE2000, gamut
src/lib/season.ts     measurement -> seasonal colour profile
src/lib/looks.ts      profile -> computed makeup looks + VTO payloads
src/lib/garment.ts    garment colour -> verdict against the palette
src/lib/products.ts   shade library and scoring
src/lib/pipeline.ts   orchestration, evidence labelling, preflight checks
src/lib/demo.ts       the recorded live response used by the sample button
src/app/api/analyze   POST: selfie -> measurement, profile, looks
src/app/api/render    POST: computed look -> YouCam makeup VTO render
src/components/*      the five UI steps
```

### Design decisions worth knowing

**Measured evidence is kept separate from generated output.** The raw API
values, the seasonal interpretation and the computed looks are shown in
separate, clearly labelled sections. The seasonal label is presented as a
styling framework, never as a measurement.

**Recorded output is labelled as recorded.** The sample is real API output that
has been captured and replayed. It is not a new measurement, and the UI says so
everywhere it appears.

**Missing measurements lower confidence rather than being estimated.** If the
API does not return a feature, it is listed as missing and the confidence score
drops. Nothing is silently filled in.

**Generated colours are verified against the sRGB gamut.** Setting a colour's
lightness can push a saturated hue outside sRGB, where the clamp silently moves
it back — changing the very depth the makeup look depends on. `withLightness`
reduces chroma only as far as necessary and reports the lightness actually
achieved, so what is shown is what was rendered.

**Foundation is matched on depth first, undertone second.** A foundation of the
right depth but slightly wrong warmth looks far better than the reverse, so the
lightness error is weighted in addition to perceptual distance. A shade whose
hue leans the other way is surfaced as a caution rather than being folded into
the score, so the ranking stays honest.

## Tests

```bash
npm test
```

The CIEDE2000 implementation is checked against the published reference pairs
from Sharma, Wu & Dalal (2005), the standard conformance set, rather than only
being self-consistent. Alongside those are regression tests for bugs found
during development — for example, an eye shadow that resolved to near-white for
light seasons, and a gamut clamp that quietly shifted a computed colour's depth.

## API notes

- `POST /s2s/v2.0/file` uploads the photo and returns a file id.
- `POST /s2s/v2.0/task/skin-tone-analysis` starts the measurement.
- `GET /s2s/v2.0/task/{id}` polls until the task completes.
- `POST /s2s/v2.0/task/makeup-vto` renders a computed look onto the photo.

Makeup effect payloads are validated before being sent: each pattern has an
expected palette count which the engine enforces, so a mismatch is caught
locally instead of costing a failed request.

## Privacy

Photos are sent to the YouCam API for measurement. This app does not store them.

## Disclaimer

Seasonal colour analysis is a styling framework used by image consultants, not a
scientific or medical assessment. The shade library is a generic demonstration
set with descriptive names; no third-party brand names or trademarked shade
names are used.

## Licence

MIT
