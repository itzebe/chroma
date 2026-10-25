# Chroma — demo video script and recording plan

Target length **2 minutes 40 seconds** (the limit is 3 minutes; judges are not
required to watch beyond it). Every claim below is one the app actually makes
about itself, and every number comes from the recorded sample.

## The honesty rule for this video

Read this before recording.

- **The measurement is a recorded sample, not a live call.** The API credits for
  this account are exhausted, so the skin tone analysis cannot be re-run. The
  sample is a real response captured from the live endpoint on 2026-10-24 and the
  app labels it "recorded response" on screen. Say that out loud in the video. Do
  not say "this is analysing my photo right now".
- **The try-on render cannot be shown.** Every render attempt returns
  `CreditInsufficiency`. Show the real error and its guidance, and say plainly
  that the render path is implemented and unit-tested but blocked on credits. Do
  not show a mock image and imply the API produced it.
- **Everything else is computed live, from the measurement, in the browser.**
  The seasonal profile, the makeup colours, the garment verdict and the shade
  ranking are all recalculated on the spot. That is the honest strong claim: the
  *measurement* is replayed, the *reasoning* is live.

If you would rather not explain the credit limit on camera, the alternative is to
re-record the whole video later with live credits. The script below is written for
the recorded-sample version, because that is what is demonstrable today.

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

**Screen:** still the composer, with the **Recorded sample** toggle highlighted.

**Narration:**
> "Two things to be upfront about. This build uses the recorded-sample path: the
> skin tone measurement you are about to see is a real response the API returned,
> captured on the 24th of October, replayed here. It is not a new call, and the
> app labels it as recorded everywhere it appears.
>
> The reason is practical — the account's API credits are exhausted. But notice
> what that does and does not limit. The measurement is replayed. Every
> recommendation built on top of it is computed live, right here."

**Action:** click **Load the recorded analysis**.

### Scene 3 — The provenance label (0:35–0:50)

**Screen:** the result header. The **recorded response** badge and the provenance
sentence are the subject.

**Narration:**
> "This is the label that matters. 'Recorded response, captured 2026-10-24 from
> the skin tone analysis endpoint. This is real API output that is replayed, not
> a new measurement.' That sentence is generated from the response's own
> provenance field, so it cannot drift out of sync with what actually happened.
>
> If this had been a live call it would read 'measured live just now' instead."

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

**Screen:** the render button, then the credit error.

**Narration:**
> "This is where it would call the makeup try-on endpoint — one unit per
> successful render. Let me press it and show you exactly what comes back, rather
> than cutting away.
>
> Credit insufficiency. The request was built correctly and rejected on billing,
> so the app reports it as retryable, says plainly that no units were charged, and
> tells you the colour analysis and shade matching still work. I would rather show
> you this than a fake render.
>
> The render path itself is real: it builds the payload you can inspect under
> 'The exact request sent to the makeup engine', and validates each effect against
> the palette count the engine enforces before spending a request."

**Action:** click **Render the Evening look**. Wait for the error. Let it sit.
Then open **The exact request sent to the makeup engine**.

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

> Measurement replayed from a recorded live response. Seasonal analysis, makeup
> colours, garment verdicts and shade rankings are computed live from it. Try-on
> render is implemented and blocked on API credits.

---

## What to say if a judge asks

**"Is any of this faked?"**
No. The measurement is a recorded response from the real endpoint, labelled as
such on screen and generated from the response's provenance field. Everything
derived from it is computed at request time.

**"Why not show the render?"**
The account's units are exhausted, so the endpoint returns `CreditInsufficiency`.
The request is built, validated and sent; only the billing check fails. Rather
than mock an image, the video shows the real error.

**"What would you do with more credits?"**
Re-record scenes 3 and 7 with a live measurement and a real render. No code
changes are needed for that — the live path is the same code with
`preferRecorded: false`.

---

## Post-recording

- Upload to YouTube as **public** (preferred) or Vimeo. Unlisted does not satisfy
  the rules as written; the rules say "publicly visible".
- No third-party trademarks or copyrighted music. The app itself uses no brand
  names or trademarked shade names, so a silent or licensed-audio track is safest.
- Put the link on the Devpost submission form.
- Keep the file under 3 minutes — trim Scene 6 before trimming Scene 7.
