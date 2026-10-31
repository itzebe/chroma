# Redesign evidence

Screenshots and checks from the frontend redesign on branch
`redesign/premium-beauty-tech`. Produced against a production build
(`next build` + `next start`), not the dev server.

## Screenshots

| File | What it shows |
| --- | --- |
| `desktop-01-homepage.png` | Homepage, 1440x900 @2x |
| `desktop-02-photo-tips-open.png` | The "Photo tips" disclosure expanded |
| `desktop-03-recorded-result.png` | Recorded result, 1440x900 @2x |
| `desktop-04-recorded-result-full.png` | Recorded result, full page |
| `mobile-01-homepage.png` | Homepage, 390x844 @3x (Android-sized) |
| `mobile-02-photo-tips-open.png` | The disclosure expanded on touch |
| `mobile-03-recorded-result.png` | Recorded result, 390x844 @3x |
| `mobile-04-recorded-result-full.png` | Recorded result, full page |

`manifest.json` records, for each image, the scroll position and the exact text
visible in the viewport when it was taken. It is emitted at capture time.

The homepage shots show the live photo-upload interface. This environment has no
YouCam key, so the health probe is answered with `apiConfigured: true` for those
two frames only; nothing is submitted and no result is fabricated. The recorded
result shots are a real replayed API response with no interception.

## Checks

Run against a running server (`npm run build && npx next start -p 3001`):

```bash
node qa.mjs      http://localhost:3001 /tmp/qa/out   # interaction + layout
node a11y.mjs    http://localhost:3001               # axe-core, WCAG 2.2 AA
node audit.mjs   http://localhost:3001               # type scale, density, banned patterns
node live-state.mjs http://localhost:3001 /tmp/qa/live
```

Each needs `puppeteer-core` and `axe-core`:

```bash
npm install puppeteer-core axe-core
```

## What was verified

- Background unchanged: page ground `#0a0c10`, panel `#11141b`, asserted on the
  rendered pixels at both widths.
- axe-core: 0 violations on the homepage and the loaded result, at 1440x900 and
  390x844 (23 and 33 checks passing respectively).
- No horizontal overflow at any tested width, including live mode.
- Every interactive target at least 24px; nav links 44px.
- Heading order valid on the homepage and with a result loaded.
- Recorded results still labelled recorded; live results still labelled live.
- All result panels still render: measured colours, seasonal profile, palette,
  look gallery, garment check, shade matcher.
- No console or page errors.

## What was not verified

- The live analysis path. It needs a YouCam key and spends 20 units, and this
  environment has no key. The upload interface, its validation and the disabled
  primary action were verified, but not a real measurement.
- The makeup render path, for the same reason (1 unit per render).
- Real-device testing. Mobile was checked at Android viewport sizes with touch
  emulation in Chromium, not on hardware.
