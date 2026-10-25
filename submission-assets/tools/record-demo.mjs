/**
 * Record a genuine end-to-end run of the DEPLOYED Chroma app, paced to the
 * narration so the footage and the voice track line up by construction.
 *
 * Every step is the real product: the skin tone analysis and the makeup render
 * are real calls to the YouCam API through the live site. Nothing is mocked,
 * staged or composited - the script only scrolls, clicks and waits.
 *
 * Pacing: `timings.json` (written by build-narration.py) gives each scene's
 * measured narration length. Scene i's actions start at the cumulative offset
 * B[i] and the recorder holds until B[i+1], so scene i's footage occupies
 * exactly the span the matching narration audio covers. Post-production then
 * trims the lead-in and muxes the narration at offset 0.
 *
 * Costs 20 units (one analysis) + 1 unit (one render) in live mode, 0 in
 * recorded mode.
 *
 * Usage: FFMPEG_BIN=... TIMINGS=... node record-demo.mjs <url> <photo> <outDir>
 * Requires DISPLAY to point at an X server (see record-demo.sh).
 */
import puppeteer from "puppeteer-core";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const URL = process.argv[2] ?? "https://chroma-r8sd.vercel.app/";
const PHOTO = process.argv[3] ?? "/tmp/chroma-face.jpg";
const OUT = process.argv[4] ?? "/tmp/chroma-demo";
const FFMPEG = process.env.FFMPEG_BIN;
const TIMINGS = process.env.TIMINGS;
const CHROME = process.env.CHROME_BIN ?? "/usr/bin/chromium";
const SIZE = process.env.SCREEN_SIZE ?? "1280x720";
const LEAD = 0.4; // seconds of page load shown before the video proper begins
// "recorded" replays the captured sample and skips the render, so the whole
// pipeline can be validated without spending a single API unit.
const MODE = process.env.DEMO_MODE ?? "live";

if (!FFMPEG) throw new Error("set FFMPEG_BIN");
if (!TIMINGS) throw new Error("set TIMINGS to timings.json");
if (!existsSync(PHOTO)) throw new Error(`no photo at ${PHOTO}`);
await mkdir(OUT, { recursive: true });

// Scene boundaries from the measured narration.
const timings = JSON.parse(await readFile(TIMINGS, "utf8"));
const durations = timings.scenes.map((s) => s.duration);
const bounds = [0];
for (const d of durations) bounds.push(bounds[bounds.length - 1] + d);
const totalTarget = bounds[bounds.length - 1];
console.log(`target video length ${totalTarget.toFixed(2)}s over ${durations.length} scenes`);

const T0 = Date.now();
const now = () => (Date.now() - T0) / 1000;
const milestones = [];
const mark = (label) => {
  const t = now();
  milestones.push({ t: Number(t.toFixed(2)), label });
  console.log(`[+${t.toFixed(1)}s] ${label}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let videoT0 = 0; // wall-clock instant that maps to video time 0
const waitUntilVideoTime = async (vt) => {
  const remaining = videoT0 + vt - now();
  if (remaining > 0) await pause(remaining * 1000);
  else console.log(`  (behind target by ${(-remaining).toFixed(1)}s at videoT=${vt})`);
};

// ---------------------------------------------------------------- recording
const raw = `${OUT}/raw.mp4`;
const ff = spawn(FFMPEG, [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "x11grab", "-draw_mouse", "1",
  "-video_size", SIZE, "-framerate", "30", "-i", process.env.DISPLAY,
  "-t", "600",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
  raw,
], { stdio: ["ignore", "ignore", "inherit"] });
mark("recording started");

// ------------------------------------------------------------------- driver
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: null,
  protocolTimeout: 600_000,
  ignoreDefaultArgs: ["--enable-automation"],
  args: [
    "--no-sandbox", "--disable-dev-shm-usage", "--test-type",
    `--window-size=${SIZE.replace("x", ",")}`, "--window-position=0,0",
    "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate,BackForwardCache,MediaRouter",
    "--hide-crash-restore-bubble", "--disable-session-crashed-bubble",
  ],
});

const page = (await browser.pages())[0] ?? await browser.newPage();
const click = async (re, sel = "button") => {
  const h = await page.evaluateHandle(
    (src, s) => {
      const rx = new RegExp(src, "i");
      return [...document.querySelectorAll(s)].find((el) =>
        rx.test((el.textContent ?? "").trim()),
      );
    },
    re.source, sel,
  );
  const el = h.asElement();
  if (!el) throw new Error(`control not found: ${re}`);
  await el.click();
};
const smoothScrollTo = async (y) => {
  await page.evaluate((target) => window.scrollTo({ top: target, behavior: "smooth" }), y);
  await pause(1400);
};
const anchor = async (heading, offset = 90) => {
  await page.evaluate(
    (text, off) => {
      const rx = new RegExp(text, "i");
      const el = [...document.querySelectorAll("h1,h2,h3")].find((e) =>
        rx.test((e.textContent ?? "").trim()),
      );
      if (!el) throw new Error(`heading not found: ${text}`);
      window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - off), behavior: "smooth" });
    },
    heading, offset,
  );
  await pause(1400);
};
const scrollTop = () => page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));

try {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  videoT0 = now() - LEAD;
  mark("app loaded (video T0 set)");

  // ---- Scene 1: the problem, on the landing fold -------------------------
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(6000);
  await smoothScrollTo(560);   // reveal the composer
  await pause(2500);
  await smoothScrollTo(980);   // the "test every feature had to pass" panel
  await waitUntilVideoTime(bounds[1]);
  mark("scene 1 done");

  // ---- Scene 2: the working app, live mode -------------------------------
  if (MODE === "recorded") {
    await click(/Load the recorded analysis/i);
    mark("recorded sample loaded (no units)");
    await page.waitForFunction(() => /Step 1 . measured/i.test(document.body.innerText), {
      timeout: 120_000, polling: 500,
    });
  } else {
    await click(/^Live measurement$/);
    await pause(2000);
    const photoInput = await page.waitForSelector("input#photo", { timeout: 20_000 });
    await photoInput.uploadFile(PHOTO);
    mark("photo chosen");
  }
  await waitUntilVideoTime(bounds[2]);
  mark("scene 2 done");

  // ---- Scene 3: the live measurement -------------------------------------
  if (MODE === "live") {
    await click(/^Measure my skin colours$/);
    mark("analysis submitted (live API call)");
    await page.waitForFunction(() => /measured live just now/i.test(document.body.innerText), {
      timeout: 300_000, polling: 500,
    });
    mark("live measurement returned");
  }
  await anchor("^What the API measured$");
  await pause(3500);
  await smoothScrollTo(await page.evaluate(() => Math.round(window.scrollY) + 330));
  await pause(3500);
  await smoothScrollTo(await page.evaluate(() => Math.round(window.scrollY) + 240));
  await waitUntilVideoTime(bounds[3]);
  mark("scene 3 done");

  // ---- Scene 4: seasonal interpretation, palette, computed looks ---------
  await anchor("^Your seasonal profile$");
  await pause(6000);
  await anchor("^Colours that work");
  await pause(3000);
  await anchor("^Makeup looks computed from your measurements$");
  await pause(3000);
  await click(/^Signature/i, '[role="tab"]');
  await pause(3000);
  await click(/^Evening/i, '[role="tab"]');
  await waitUntilVideoTime(bounds[4]);
  mark("scene 4 done");

  // ---- Scene 5: the real makeup virtual try-on ---------------------------
  if (MODE === "recorded") {
    mark("render skipped in recorded dry-run");
  } else {
    await click(/^Render the .* look$/);
    mark("render submitted (live API call)");
    await page.waitForFunction(() => {
      const img = [...document.querySelectorAll("img")].find((i) =>
        /rendered by the YouCam/i.test(i.alt ?? ""),
      );
      return Boolean(img && img.naturalWidth > 0);
    }, { timeout: 300_000, polling: 500 });
    mark("render returned");
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("img")].find((i) =>
        /rendered by the YouCam/i.test(i.alt ?? ""),
      );
      window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 150), behavior: "smooth" });
    });
  }
  await waitUntilVideoTime(bounds[5]);
  mark("scene 5 done");

  // ---- Scene 6: shopping value -------------------------------------------
  await anchor("^Will this colour work on you");
  await pause(6500);
  await anchor("^Shades that match your measured colouring");
  await waitUntilVideoTime(bounds[6]);
  mark("scene 6 done");

  // ---- Scene 7: conclusion ----------------------------------------------
  await scrollTop();
  await pause(3000);
  await waitUntilVideoTime(bounds[7]);
  mark("scene 7 done");
} finally {
  await browser.close();
  ff.kill("SIGINT");
  await new Promise((r) => ff.on("exit", r));
  mark("recording stopped");
}

await writeFile(`${OUT}/milestones.json`, JSON.stringify(
  { mode: MODE, videoT0: Number(videoT0.toFixed(2)), lead: LEAD, totalTarget,
    durations, bounds, milestones }, null, 2));
console.log(`\nwrote ${OUT}/milestones.json`);
