# Chroma — demo video script and recording plan

Target length **2 minutes 40 seconds** (the limit is 3 minutes; judges are not
required to watch beyond it). Every claim below is one the app actually makes
about itself, and every number comes from a live run or the recorded sample.

## The honesty rule for this video

Read this before recording.

- **The measurement runs live, and the render runs live.** The account has API
  units, so both the skin tone analysis and the makeup try-on can be performed
  for real while recording. If units run out mid-record the app reports the
  `CreditInsufficiency` error honestly and charges nothing, and the
  **Recorded sample** button replays a captured response instead.
- **The try-on render is real.** Pressing render sends the computed look to the
  makeup VTO endpoint and shows the composited image of the same photo. One unit
  per successful render. Show the returned image; do not substitute a mock.
- **Everything else is computed live, from the measurement, in the browser.**
  The seasonal profile, the makeup colours, the garment verdict and the shade
  ranking are all recalculated on the spot.

The strongest version of the video is the fully live one: measure a real photo,
then render a real look, and point out that the colours being composited were
computed from the measurement rather than picked from a preset list. The script
below does that, and falls back to the **Recorded sample** path only if units are
exhausted.

---

## Pre-recording checklist

1. `npm run dev` in one terminal. Confirm `http://localhost:3000/api/analyze`
   returns `{"ok":true,"apiConfigured":true,...}`.
2. Browser at **1440×900**, zoom 100%, one window only. Close other tabs and
   bookmarks so no personal data appears.
3. Confirm no API key is visible anywhere on screen. The header only ever says
   "API key configured".
4. Prepare a second window showing `src/lib/looks.ts` for the code beat (step 5
   below). Have the file scrolled to the shadow-generation function.
5. Start recording **before** the first click. Capture the full browser window,
   not a region, so the URL bar is visible and the app is obviously real.
6. Speak at a normal pace. The timings below already include pauses for clicks.

---

## Scene-by-scene plan

### Scene 1 — The problem (0:00–0:18)

**Screen:** the landing page, top of fold. Do not scroll yet.

**Narration:**
> "Most beauty advice is a static chart. You look at a colour wheel, decide you
> are a 'winter', and buy a foundation that turns out to be the wrong depth for
> your actual skin. The advice never looked at your face.
>
> Chroma starts from the opposite end. It measures your face with the YouCam API
> and then computes everything else from those measurements."

**Action:** none. Let the hero and the "Would this work the same without YouCam?"
panel sit on screen.

### Scene 2 — What is on screen, and what is honest about it (0:18–0:35)

**Screen:** still the composer, with the **Recorded sample** toggle visible.

**Narration:**
> "One thing to be upfront about. This build can run the measurement live — the
> photo goes to the YouCam skin tone analysis endpoint and comes back with four
> measured colours. There is also a recorded-sample path, which replays a real
> response the API returned on the 24th of October, and the app labels that as
> recorded wherever it appears. I will run it live."

**Action:** choose a photo (or paste an image URL) and click **Analyse**.

### Scene 3 — The provenance label (0:35–0:50)

**Screen:** the result header. The provenance sentence is the subject.

**Narration:**
> "This is the label that matters. 'Measured just now from the skin tone analysis
> endpoint.' That sentence is generated from the response's own provenance field,
> so it cannot drift out of sync with what actually happened — if this had been
> the recorded sample it would say 'recorded response, captured 2026-10-24'
> instead, and name the endpoint it came from."

**Action:** scroll so the badge and the sentence are both comfortably in frame.

### Scene 4 — The measurement (0:50–1:10)

**Screen:** Step 1 — measured.

**Narration:**
> "Four colours, straight from the API. Skin, lips, eyes, brows — each with its
> measured lightness, chroma and hue. Nothing here is averaged, adjusted or
> filled in.
>
> The API also returned quality checks, and it did not return hair colour. The app
> does not invent the missing value — it lists the feature as missing and lowers
> the confidence score instead. That is a deliberate choice: a guess would look
> tidier and be less honest."

**Action:** scroll to **What the API measured**.

### Scene 5 — The interpretation (1:10–1:32)

**Screen:** Step 2 — seasonal profile, including the axis breakdown.

**Narration:**
> "From those four hex values the app derives a seasonal colour profile — here,
> Bright Spring. The important part is that it shows its work. Undertone is voted
> on by five independent signals, weighted, then combined, and each signal is
> printed with the number it contributed.
>
> Skin hue angle alone cannot separate warm from cool — on the reference set the
> two overlap by about a degree — so the app refuses to answer from that single
> number. Conflicting signals produce 'neutral' rather than a confident guess."

**Action:** scroll to **Your seasonal profile**, then open
**How the undertone was decided**.

### Scene 6 — The palette and the computed looks (1:32–2:00)

**Screen:** the palette, then Step 3.

**Narration:**
> "The palette is the reference every later calculation measures against.
>
> Now the part that makes this more than a wrapper. The YouCam makeup engine takes
> arbitrary hex colours. So the app does not pick a preset look — it *computes*
> one, transforming your measured colours in CIELAB, and prints the exact
> transformation under every swatch. This swatch is the accent colour with
> saturation pulled back 12 percent for daytime. This one is the Chestnut palette
> colour with its lightness set to 40 — your measured skin lightness minus 22.
>
> And this is the fix I am proudest of. The eye shadow was originally resolving to
> near-white, because the 'neutral' swatch in a bright palette *is* near-white.
> Shadows are now set to a depth relative to your measured skin, so they read as
> shadow. Watch the three looks: the deepest layer steps down 40, then 32, then 22
> lightness."

**Action:** scroll to **Your palette**, then to **Makeup looks computed from your
measurements**. Click **Signature**, pause, then **Evening**. Point at the
"lightness set to L\* 40 / 32 / 22" provenance lines.

### Scene 7 — The try-on path, honestly (2:00–2:22)

**Screen:** the render button, then the rendered result.

**Narration:**
> "This is the makeup try-on endpoint — one unit per successful render. Let me
> press it for real.
>
> That is the composited image: the same photo, with the look the app computed
> from your measured colours. Nothing was picked from a preset list — the colours
> came out of the analysis, and the engine put them on the face.
>
> The request itself is inspectable under 'The exact request sent to the makeup
> engine'. Each effect is validated against the pattern and texture rules the
> engine enforces before a request is spent, so a malformed payload is caught
> locally rather than costing a unit."

**Action:** click **Render the Evening look**. Wait for the image. Let it sit.
Then open **The exact request sent to the makeup engine**.

> If units are exhausted instead, the app shows the API's real
> `CreditInsufficiency` error, marked retryable and as having charged no units.
> Show that error and say so plainly rather than cutting away.

### Scene 8 — Shopping, grounded in the measurement (2:22–2:40)

**Screen:** Step 4, then Step 5.

**Narration:**
> "Last piece: shopping advice, grounded in the same measurement. Paste any
> garment colour and it is scored with CIEDE2000 — the same perceptual distance
> the makeup engine uses — against your palette, and it suggests the nearest
> colour that would work better.
>
> And foundation is matched on depth first, undertone second, because the wrong
> depth is far more visible than slightly wrong warmth. Where a shade leans the
> other way, the app says so rather than burying it in the score: 'its hue sits
> 25 degrees from your measured skin colour — swatch it before buying.'
>
> One measurement, and every recommendation traces back to it. That is the whole
> idea."

**Action:** scroll to **Will this colour work on you?** Type a hex such as
`c19a6b` to show the verdict change, then scroll to **Shades that match your
measured colouring** and point at the caution line on the third shade.

### Closing card (2:40)

**Screen:** static. Title **Chroma**, subtitle *Skin intelligence and virtual
try-on, built on the YouCam API*, and a small caption:

> Measurement taken live from the YouCam skin tone analysis endpoint. Seasonal
> analysis, makeup colours, garment verdicts and shade rankings are computed live
> from it. Try-on render composited live by the makeup VTO endpoint.

---

## What to say if a judge asks

**"Is any of this faked?"**
No. The measurement and the render are both real calls to the YouCam API. The
recorded-sample path exists only as a fallback for when units run out, and it is
labelled as recorded on screen from the response's own provenance field.

**"How much does a session cost?"**
One unit per render; the skin tone analysis is the measurement. Everything
downstream of the measurement is local arithmetic, so the cost is per render, not
per recommendation.

**"What would you do with more credits?"**
Nothing structural. The live path is the same code with `preferRecorded: false`,
and the render is already live.

---

## Post-recording

- Upload to YouTube as **public** (preferred) or Vimeo. Unlisted does not satisfy
  the rules as written; the rules say "publicly visible".
- No third-party trademarks or copyrighted music. The app itself uses no brand
  names or trademarked shade names, so a silent or licensed-audio track is safest.
- Put the link on the Devpost submission form.
- Keep the file under 3 minutes — trim Scene 6 before trimming Scene 7.
