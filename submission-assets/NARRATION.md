# Chroma — demo narration (English)

Each `##` block is one scene, matched to a segment of the screen recording.
`[[pause N]]` is a silent hold of N seconds. The total is measured by
`tools/build-narration.py`, never assumed. The same words appear as burned-in
subtitles, so the video is legible with or without the synthetic audio track.

---

## S1 — problem (landing page, top of fold)

Most colour advice is a static chart. You decide you are a winter, buy a
foundation, and it is the wrong depth for your actual skin, because nothing ever
looked at your face.

Chroma starts from the opposite end. It measures your face with the YouCam API,
then computes everything else from those measurements.

[[pause 2]]

## S2 — the working app (composer, live mode)

This is the deployed app. You give it one photo. The analysis is a real call to
the YouCam skin tone analysis endpoint. There is a recorded sample too, labelled
as recorded, but I will run it live.

## S3 — live measurement

I choose the live path, pick a photo, and run the measurement. The photo goes to
the YouCam skin tone analysis API, which returns the measured colours.

Four colours, straight from the API: skin, lips, eyes and brows, each with its
measured lightness, chroma and hue. Nothing is averaged or filled in. The API did
not return hair colour, so the app lists it as missing and lowers its confidence,
rather than inventing a value.

[[pause 4]]

## S4 — seasonal interpretation and looks

From those four hex values, Chroma derives a seasonal profile. Here, Bright
Spring. The app shows its work: every signal that voted on the undertone, and
what each contributed. This is a styling framework, not a medical diagnosis.

The YouCam makeup engine accepts arbitrary hex colours, so the looks are not
presets. Each is computed from the measured palette, and the exact transformation
is printed under every swatch.

[[pause 4]]

## S5 — real virtual try-on

Now the try-on. I press render, and the computed look is sent to the YouCam makeup
virtual try-on endpoint.

That is the composited image: the same photo, with the look computed from the
measured colours. Nothing is a preset, and nothing is manually edited.

[[pause 5]]

## S6 — shopping value

The same measurement drives the shopping advice. Any garment colour is scored
against the palette with CIEDE2000, the perceptual distance the makeup engine
uses, and the app suggests a colour that would work better.

Foundation is matched on depth first, undertone second, because the wrong depth is
far more visible than slightly wrong warmth.

[[pause 4]]

## S7 — conclusion

Measure, interpret, personalize, try on, compare. One measurement, and every
recommendation traces back to it. That is the whole idea.

Try it at chroma-r8sd.vercel.app.

[[pause 3]]
