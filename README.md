# Chroma

Skin intelligence and virtual try-on, built on the YouCam API.

A person uploads one selfie. The YouCam Skin AI measures the actual colours on
their face. Those measurements become a seasonal colour profile, and from that
profile the app **computes** makeup looks, judges whether a garment colour works
on them, and ranks product shades against their own skin.

Built for the **YouCam API Skin AI & eCommerce VTO Hackathon**.

This is a new project, created during the Hackathon Submission Period (which
opened 2026-09-29). It has no prior history outside this repository and was not
derived from an earlier codebase.

---

## YouCam APIs used

Two Perfect Corp. YouCam endpoints are integrated, from the Skin and Beauty
categories:

| Endpoint | Category | Role in the app |
| --- | --- | --- |
| `POST /s2s/v2.0/task/skin-tone-analysis` | Skin AI | Measures skin, lip, eye and brow colour from the uploaded photo. This single response is the root input: every number the app displays is derived from it. |
| `POST /s2s/v2.0/task/makeup-vto` | Beauty / makeup VTO | Composites a computed makeup look onto the user's own photo. |

Both are reached through a shared upload and polling flow
(`POST /s2s/v2.0/file`, then `GET /s2s/v2.0/task/{id}`). See
[API notes](#api-notes) for the full sequence and
[Not wired up](#not-wired-up) for the endpoint that is present in the client but
deliberately not exposed.

---

## Verified status

What is demonstrably working today, and what is not:

| Capability | Status |
| --- | --- |
| Skin tone measurement (live API call) | Verified. A live call succeeded, and its captured response is what the **Recorded sample** button replays. Costs 20 units; a failed call costs none. |
| Skin tone measurement (re-run live) | Verified. Runs live against the API, and reports `CreditInsufficiency` honestly if units run out. |
| Photo upload (`POST /s2s/v2.0/file`) | Verified. An uploaded photo is analysed and its `file_id` is reused for the render, so the bytes are not uploaded twice. Costs no units. |
| Seasonal profile, makeup look computation, garment verdict, shade ranking | Verified. Computed at request time from the measurement. |
| Makeup virtual try-on render | Verified. All three computed looks render live, and the render is rebuilt from the measurement on screen rather than from the fixture, so the composited photo matches the swatches above it. Costs 1 unit; a failed render costs none. |

The **Recorded sample** button replays a real captured response so the whole
product can be exercised without spending units. It is labelled as recorded
everywhere it appears, and the label is generated from the response's own
provenance field rather than being hard-coded prose. When the app runs a real
call, the same label reads "measured live just now".

The app does not mock the render path. When units run out, pressing render shows
the API's actual `CreditInsufficiency` error, marked as retryable and as having
charged no units.

---

## The one test every feature had to pass

> **Would this work the same without the YouCam API?**

If the answer was yes, the feature was cut. That single question is what
separates this from a colour-analysis wrapper with an API call bolted on:

| Feature | Why it needs YouCam |
| --- | --- |
| Measured colours | Skin, lip, eye and brow hex values are read from the photo. Nothing asks the user to self-report their undertone. |
| Computed looks | The makeup engine accepts arbitrary hex colours, so every look is derived from the measured palette by explicit Lab transformations. Each transformation is printed on screen. |
| Real render | The makeup VTO endpoint composites those computed colours onto the user's actual photo. Verified live for all three looks — see Verified status. |
| Grounded shopping advice | Garment verdicts and shade rankings are perceptual distances from the measured colours, not a static chart. |

The whole product is therefore downstream of one API call. Change the photo and
every number on the page changes with it.

## What it does

The problem: colour advice is usually a static chart. You decide you are a
"winter", buy a foundation, and it is the wrong depth for your actual skin,
because nothing ever looked at your face. Chroma inverts that. It measures the
face first, with the YouCam API, and derives every recommendation from those
measurements.

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

### Who it is for

Someone buying foundation or a lipstick online, where the colour on the screen
is the only colour they get. Shade charts cannot answer "will this work on
*me*", because they never saw the face. Chroma answers from the person's own
measurement, and shows the arithmetic, so the answer can be checked rather than
trusted. The same measurement also settles the question that costs the most
money to get wrong: whether a garment colour works before it is bought.

The measurement is a single API call per person, and everything else is local
arithmetic — so the cost per session is one call, not one call per
recommendation.

## Quick start

Requires Node.js 20 or newer (developed on Node 24).

```bash
npm install
cp .env.example .env.local   # then fill in YOUCAM_API_KEY
npm run dev                  # http://localhost:3000
```

Without a key the UI still loads, but analysis and rendering are unavailable.
The **Recorded sample** button replays a captured live API response, so the
whole interface can be explored and judged without spending API units.

To check the install is sound without any credentials:

```bash
npm test        # 129 unit tests, no network access
npm run verify  # tests, typecheck and production build
```

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `YOUCAM_API_KEY` | yes | Server-side only. Never sent to the browser. |
| `YOUCAM_API_BASE_URL` | no | Defaults to `https://yce-api-01.makeupar.com`. |

The key is read from the environment at call time. It is never logged, never
included in a response, and never written to a file in this repository.

### Upload size

Uploads are capped at **4 MB**, checked in the browser and again in the route
handler. The cap is set below Vercel's 4.5 MB platform request-body limit: a
larger body is rejected at the edge, before the function runs, and the user sees
a platform error instead of the app's own message. Most phone photos exceed
4 MB, so the interface says so up front and points at compressing the photo.

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
src/lib/upload-limit.ts  the 4 MB upload cap, shared by browser and route
src/lib/api-response.ts  fetch response -> result, without mislabelling errors
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
light seasons, a gamut clamp that quietly shifted a computed colour's depth, a
render that rebuilt its look from the fixture instead of the measurement on
screen, and a file upload that read the file id from the wrong level of the
response envelope.

## API notes

- `POST /s2s/v2.0/file` uploads the photo and returns a file id.
- `POST /s2s/v2.0/task/skin-tone-analysis` starts the measurement.
- `GET /s2s/v2.0/task/{id}` polls until the task completes.
- `POST /s2s/v2.0/task/makeup-vto` renders a computed look onto the photo.

Makeup effect payloads are validated before being sent: each pattern has an
expected palette count which the engine enforces, so a mismatch is caught
locally instead of costing a failed request.

Palette entries also carry texture-dependent companion fields. The published
JSON schema marks these optional, but the live engine rejects a palette that
omits them and reports the exact omissions — a satin blush without `glowStrength`,
a shimmer eye shadow without `shimmerColor` and `shimmerIntensity`, a gloss lip
without `transparencyIntensity`. `PALETTE_TEXTURE_RULES` in `src/lib/looks.ts`
encodes the matrix, and both the payload builders and `validateLook` read it, so
a look cannot be built that the engine will refuse for this reason.

### Not wired up

`src/lib/youcam.ts` also contains a client for the apparel try-on endpoint
(`/s2s/v2.0/task/cloth-v4`), but it is not called by any route or component and
has no tests. It is not part of the submitted experience and nothing in the UI
depends on it. The "VTO" in this project is the makeup try-on above.

## Privacy

Photos are sent to the YouCam API for measurement. This app does not store them.

## Submission assets

`submission-assets/` holds the material prepared for judging. It is not needed to
run the app.

```
submission-assets/
  screenshots/         13 screenshots of the running app, plus manifest.json
  tools/               the scripts that produced them (reproducible)
  DEMO_SCRIPT.md       narration, scene plan and recording checklist
```

`screenshots/manifest.json` records, for every image, the scroll position and the
exact text visible in the viewport when it was taken. It is emitted at capture
time, so it is evidence that each screenshot shows what its filename claims
rather than a description written after the fact.

Regenerate with the dev server running:

```bash
cd submission-assets/tools
npm install                                   # puppeteer-core, per package.json
node capture-screenshots.mjs http://localhost:3000 ../screenshots /path/to/face.jpg
python3 inspect-screenshots.py ../screenshots   # flags blank/flat frames
```

The third argument is the photo for the live shots. Omit it to capture only the
recorded-sample set without spending units. The live path costs 20 units for the
analysis and 1 for the render.

`verify-live-path.mjs` is the companion check: it drives the live path through
the real UI and asserts the controls are reachable and the result is labelled as
a live measurement, which a unit test cannot see. It costs 20 units.

```bash
node verify-live-path.mjs http://localhost:3000 /path/to/face.jpg
```

The first ten screenshots are of the recorded-sample workflow, which is why they
show the "recorded response" label. The recorded path is captured there so the
whole interface can be reviewed without spending API units.

The last three are the live path. `11-live-measurement.png` is a real skin tone
analysis, and its frame carries the "measured live just now" label and the
measured hex values straight from that call. `12-live-render.png` is a real
makeup render of the same photo: its computed look is named "Rust", which is the
True Autumn signature the live measurement produced, not the "Vermilion" of the
recorded Bright Spring sample - visible evidence that the render follows the
measurement rather than a fixture. `13-full-page.png` records the whole page.

## Disclaimer

Seasonal colour analysis is a styling framework used by image consultants, not a
scientific or medical assessment. The shade library is a generic demonstration
set with descriptive names; no third-party brand names or trademarked shade
names are used.

## Licence

MIT
