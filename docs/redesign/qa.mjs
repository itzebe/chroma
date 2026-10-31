/**
 * Visual QA harness for the CHROMA redesign.
 *
 * Renders the real app in Chromium at desktop and Android sizes, records the
 * computed background of the page and of a panel (so "the background did not
 * change" is a measurement, not a claim), checks for horizontal overflow, checks
 * the accordions actually open, and saves screenshots for the PR.
 *
 * Usage: node qa.mjs <baseUrl> <outDir>
 */
import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "/tmp/qa/shots";
const CHROME = "/usr/bin/chromium";

await mkdir(OUT, { recursive: true });

const report = { base: BASE, at: new Date().toISOString(), viewports: {}, checks: [] };
const fail = [];
const check = (ok, label, detail = "") => {
  report.checks.push({ ok, label, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 300_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("requestfailed", (r) => consoleErrors.push(`requestfailed ${r.url()}`));

for (const [name, viewport] of Object.entries({
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
})) {
  await page.setViewport(viewport);
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 600));

  const metrics = await page.evaluate(() => {
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const panel = document.querySelector(".panel");
    const panelBg = panel ? getComputedStyle(panel).backgroundColor : null;
    const h1 = document.querySelector("h1");
    const h1Font = h1 ? getComputedStyle(h1).fontFamily : null;
    const h1Size = h1 ? getComputedStyle(h1).fontSize : null;
    const primary = h1Font ? h1Font.split(",")[0].replace(/["']/g, "").trim() : null;
    // The face actually used for the headline must be a loaded webfont, not the
    // metric fallback - otherwise the brand type silently degrades.
    const h1Face = [...document.fonts].find((f) => f.family === primary);
    const h1FaceStatus = h1Face ? h1Face.status : "missing";
    const scrollW = document.documentElement.scrollWidth;
    const clientW = document.documentElement.clientWidth;
    const words = document.body.innerText.trim().split(/\s+/).length;
    // WCAG 2.2 SC 2.5.8 (AA): controls need a 24x24 CSS px target. Inline links
    // inside a run of text are exempt, so they are excluded.
    const smallTargets = [...document.querySelectorAll("button,summary,input:not([type=hidden]),select,textarea")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (el.classList.contains("sr-only")) return false;
        return r.height < 24 || r.width < 24;
      })
      .map((el) => `${el.tagName}:${(el.textContent ?? "").trim().slice(0, 28)}`);
    return { bodyBg, panelBg, h1Font, h1FaceStatus, h1Size, scrollW, clientW, words, smallTargets };
  });

  report.viewports[name] = { viewport, ...metrics };

  check(metrics.bodyBg === "rgb(10, 12, 16)", `[${name}] page background is unchanged (#0a0c10)`, metrics.bodyBg);
  check(metrics.panelBg === "rgb(17, 20, 27)", `[${name}] panel background is unchanged (#11141b)`, metrics.panelBg);
  check(
    metrics.h1FaceStatus === "loaded",
    `[${name}] headline uses the loaded display webfont`,
    `${metrics.h1Font ?? "no h1"} (face status: ${metrics.h1FaceStatus})`,
  );
  check(metrics.scrollW <= metrics.clientW, `[${name}] no horizontal overflow`, `${metrics.scrollW} vs ${metrics.clientW}`);
  check(metrics.smallTargets.length === 0, `[${name}] touch targets are at least 24px`, metrics.smallTargets.join(", "));

  // Above the fold: the hero and composer must fit without scrolling.
  const fold = await page.evaluate(() => {
    const composer = document.querySelector("#composer");
    const r = composer?.getBoundingClientRect();
    return { composerTop: r ? Math.round(r.top) : null, innerHeight: window.innerHeight };
  });
  check(
    fold.composerTop !== null && fold.composerTop < fold.innerHeight,
    `[${name}] the composer starts inside the first viewport`,
    `top=${fold.composerTop} vh=${fold.innerHeight}`,
  );

  await page.screenshot({ path: `${OUT}/${name}-01-home.png` });
  await page.screenshot({ path: `${OUT}/${name}-02-home-full.png`, fullPage: true });

  // Accordions must open and close.
  const accordion = await page.evaluate(() => {
    const d = document.querySelector("details.disclosure");
    if (!d) return null;
    const before = d.open;
    d.querySelector("summary")?.click();
    const opened = d.open;
    d.querySelector("summary")?.click();
    return { before, opened, closed: d.open };
  });
  check(
    accordion && accordion.before === false && accordion.opened === true && accordion.closed === false,
    `[${name}] the disclosure opens and closes`,
    JSON.stringify(accordion),
  );

  // Open the first disclosure and shoot it, so the PR shows the pattern.
  await page.evaluate(() => {
    document.querySelector("details.disclosure summary")?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/${name}-03-disclosure.png` });
  await page.evaluate(() => {
    document.querySelector("details.disclosure summary")?.click();
  });
}

// The recorded path must still work end to end, on mobile.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120_000 });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /^Load the recorded analysis$/i.test((b.textContent ?? "").trim()),
  );
  if (!btn) throw new Error("recorded button not found");
  btn.click();
});
await page.waitForFunction(() => /Step 1/i.test(document.body.innerText), { timeout: 120_000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const resultText = await page.evaluate(() => document.body.innerText);
check(/recorded response/i.test(resultText), "the recorded sample still renders a labelled result");
check(/What the API measured|Your colours, as measured/i.test(resultText), "the measured-colour step still renders");
check(/Your seasonal profile/i.test(resultText), "the seasonal profile still renders");
check(/Looks made from your colours|computed from your measurements/i.test(resultText), "the look gallery still renders");
check(/Will this colour work on you/i.test(resultText), "the garment checker still renders");
check(/Shades that match/i.test(resultText), "the shade matcher still renders");
check(/recorded response/i.test(resultText) && !/measured live just now/i.test(resultText), "the result is labelled recorded, not live");
await page.screenshot({ path: `${OUT}/mobile-04-recorded-result.png` });
await page.screenshot({ path: `${OUT}/mobile-05-recorded-result-full.png`, fullPage: true });

// The recorded/live control must be present and operable, and the label must
// match whichever mode the page actually opened in. With no server key the page
// correctly opens in recorded mode; with a key it opens on the photo upload.
await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120_000 });
const health = await page.evaluate(async () => (await fetch("/api/analyze")).json());

const readMode = () =>
  page.evaluate(() => {
    const radios = [...document.querySelectorAll('[role="radio"]')];
    const live = radios.find((b) => /^Live measurement$/i.test((b.textContent ?? "").trim()));
    const recorded = radios.find((b) => /^Recorded sample$/i.test((b.textContent ?? "").trim()));
    return {
      controlPresent: Boolean(live && recorded),
      liveChecked: live?.getAttribute("aria-checked") ?? null,
      recordedChecked: recorded?.getAttribute("aria-checked") ?? null,
      liveLabel: /Live: measured now from your photo/i.test(document.body.innerText),
      recordedLabel: /Recorded: real API output/i.test(document.body.innerText),
      photoInput: Boolean(document.querySelector("input#photo")),
    };
  });

const opened = await readMode();
check(opened.controlPresent, "the recorded/live control is present");
check(
  health.apiConfigured ? opened.liveChecked === "true" : opened.recordedChecked === "true",
  "the page opens in the mode it can actually run",
  `apiConfigured=${health.apiConfigured} live=${opened.liveChecked} recorded=${opened.recordedChecked}`,
);
check(
  opened.liveLabel !== opened.recordedLabel,
  "exactly one provenance label is shown",
  `live=${opened.liveLabel} recorded=${opened.recordedLabel}`,
);
check(
  health.apiConfigured ? opened.photoInput : !opened.photoInput,
  "the photo input is shown only when live analysis is offered",
  `apiConfigured=${health.apiConfigured} input=${opened.photoInput}`,
);

// Now drive the control the other way and confirm the label follows it.
const otherLabel = health.apiConfigured ? "Recorded sample" : "Live measurement";
await page.evaluate((label) => {
  const radio = [...document.querySelectorAll('[role="radio"]')].find(
    (b) => new RegExp(`^${label}$`, "i").test((b.textContent ?? "").trim()),
  );
  radio?.click();
}, otherLabel);
await new Promise((r) => setTimeout(r, 300));
const switched = await readMode();
check(
  switched.liveLabel !== switched.recordedLabel,
  `switching to "${otherLabel}" swaps the provenance label`,
  `live=${switched.liveLabel} recorded=${switched.recordedLabel}`,
);
if (!health.apiConfigured) {
  report.note = "no server API key here, so the page opened in recorded mode as designed";
}
const liveOverflow = await page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
check(liveOverflow.scrollW <= liveOverflow.clientW, "no overflow in live mode", JSON.stringify(liveOverflow));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${OUT}/mobile-06-live-mode.png` });

report.consoleErrors = consoleErrors;
check(consoleErrors.length === 0, "no console or page errors", consoleErrors.slice(0, 5).join(" | "));

await browser.close();
await writeFile(`${OUT}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(`\n${fail.length === 0 ? "all visual checks passed" : `${fail.length} check(s) failed`}`);
process.exit(fail.length === 0 ? 0 : 1);
