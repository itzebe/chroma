/**
 * Capture genuine screenshots of the running Chroma app, anchored on unique
 * section headings, and write a manifest recording the text actually visible in
 * each frame. The manifest is the evidence that a screenshot shows what its
 * filename claims - it is generated at capture time, not written by hand.
 *
 * Usage: node capture.mjs <baseUrl> <outDir>
 */
import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "/workspace/project/submission-assets/screenshots";
const CHROME = "/usr/bin/chromium";

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 420_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=2"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

const manifest = [];

/** Text visible in the viewport right now, in document order. */
const visibleText = () =>
  page.evaluate(() => {
    const out = [];
    // Text inside a closed <details> is laid out but not painted, so its rect
    // looks visible. Exclude it explicitly, or the manifest over-reports.
    const inClosedDetails = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p.tagName === "DETAILS" && !p.open) return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("h1,h2,h3,h4,p,li,button,span,dt,dd,th,td,div,summary,code,figcaption")) {
      if (el.children.length > 0) continue;
      if (inClosedDetails(el)) continue;
      if (!el.checkVisibility({ checkOpacity: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.width === 0 || r.height === 0) continue;
      const t = (el.textContent ?? "").trim();
      if (t) out.push(t);
    }
    return out;
  });

/**
 * Scroll so that the heading matching `heading` sits `offset` px from the top
 * of the viewport, then wait for the scroll position to settle.
 */
async function anchor(heading, offset = 80) {
  await page.evaluate(
    (text, off) => {
      const rx = new RegExp(text, "i");
      const el = [...document.querySelectorAll("h1,h2,h3")].find((e) =>
        rx.test((e.textContent ?? "").trim()),
      );
      if (!el) throw new Error(`heading not found: ${text}`);
      const y = el.getBoundingClientRect().top + window.scrollY - off;
      window.scrollTo(0, Math.max(0, y));
    },
    heading,
    offset,
  );
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const y = await page.evaluate(() => Math.round(window.scrollY));
    if (y === last) break;
    last = y;
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function shot(name, { full = false } = {}) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  const vis = await visibleText();
  const info = await page.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    docHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  manifest.push({
    name,
    file: `${name}.png`,
    scrollY: info.scrollY,
    docHeight: info.docHeight,
    visibleText: vis,
  });
  console.log(`  ${name}  y=${info.scrollY}/${info.docHeight}`);
}

console.log("-> loading", BASE);
await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120_000 });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 900));

// 1. Landing: hero + composer, before any analysis.
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 400));
await shot("01-landing-composer");

console.log("-> loading the recorded sample through the real button");
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /Load the recorded analysis/i.test(b.textContent ?? ""),
  );
  if (!btn) throw new Error("recorded-sample button not found");
  btn.click();
});
await page.waitForFunction(() => /Step 1 - measured|Step 1 — measured/i.test(document.body.innerText), {
  timeout: 120_000,
});
await new Promise((r) => setTimeout(r, 1800));

// 2. Provenance panel: the "recorded response" badge.
await page.evaluate(() => {
  const el = [...document.querySelectorAll("span")].find((e) =>
    /^recorded response$/i.test((e.textContent ?? "").trim()),
  );
  if (!el) throw new Error("provenance badge not found");
  const y = el.getBoundingClientRect().top + window.scrollY - 140;
  window.scrollTo(0, Math.max(0, y));
});
await new Promise((r) => setTimeout(r, 700));
await shot("02-provenance-recorded-response");

// 3. Step 1 - measured colours.
await anchor("^What the API measured$");
await shot("03-step1-measured-colours");

// 4. Step 2 - seasonal profile.
await anchor("^Your seasonal profile$");
await shot("04-step2-seasonal-profile");

// 5. The palette.
await anchor("^Colours that work");
await shot("05-palette");

// 6. Step 3 - computed looks (everyday is the default tab).
await anchor("^Makeup looks computed from your measurements$");
await shot("06-step3-computed-looks");

// 7. Signature look.
await page.evaluate(() => {
  [...document.querySelectorAll('[role="tab"]')]
    .find((b) => /^Signature/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await new Promise((r) => setTimeout(r, 700));
await anchor("^Makeup looks computed from your measurements$");
await shot("07-step3-signature-look");

// 8. Evening look.
await page.evaluate(() => {
  [...document.querySelectorAll('[role="tab"]')]
    .find((b) => /^Evening/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await new Promise((r) => setTimeout(r, 700));
await anchor("^Makeup looks computed from your measurements$");
await shot("08-step3-evening-look");

// 9. Step 4 - garment verdict.
await anchor("^Will this colour work on you");
await shot("09-step4-garment-verdict");

// 10. Step 5 - shade ranking (foundation tab, where the undertone caution is).
await anchor("^Shades that match your measured colouring");
await shot("10-step5-shade-ranking");

// 11. Try-on: press render and capture the live composited result.
console.log("-> pressing render (live units available; this is the real result)");
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /Render the/i.test((b.textContent ?? "").trim()),
  );
  if (!btn) throw new Error("render button not found");
  btn.click();
});
// The engine usually returns in ~10-30s; wait for the rendered image rather
// than a fixed delay so a slow render is not captured mid-flight.
await page.waitForFunction(
  () => {
    const img = [...document.querySelectorAll("img")].find((i) =>
      /rendered by the YouCam/i.test(i.alt ?? ""),
    );
    return Boolean(img && img.naturalWidth > 0);
  },
  { timeout: 180_000, polling: 1000 },
);
await page.evaluate(() => {
  // Pick the INNERMOST matching node: an outer wrapper also contains the text.
  const cands = [...document.querySelectorAll("img")].filter((e) =>
    /rendered by the YouCam/i.test(e.alt ?? ""),
  );
  const el = cands[0];
  if (!el) throw new Error("rendered image not found after render");
  const y = el.getBoundingClientRect().top + window.scrollY - 200;
  window.scrollTo(0, Math.max(0, y));
});
await new Promise((r) => setTimeout(r, 700));
await shot("11-tryon-live-render");

// 12. Full page, for a complete visual record.
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 500));
await shot("12-full-page", { full: true });

await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`\nwrote ${OUT}/manifest.json with ${manifest.length} entries`);
await browser.close();
