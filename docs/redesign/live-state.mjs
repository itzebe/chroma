/**
 * Visual QA for the live-upload state.
 *
 * The live state only renders when the server reports a configured API key, and
 * this environment has none. The health response is therefore stubbed so the
 * upload interface can be seen and measured. Nothing else is stubbed: the app
 * code, the styles and the interactions are the real ones, and no analysis is
 * faked - the script never submits the form.
 *
 * Usage: node live-state.mjs <baseUrl> <outDir>
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "/tmp/qa/live";
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  protocolTimeout: 300_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
// Stub only the health probe, so the UI believes a key is present.
await page.setRequestInterception(true);
page.on("request", (req) => {
  if (req.url().endsWith("/api/analyze") && req.method() === "GET") {
    req.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, apiConfigured: true, endpoint: "/s2s/v2.0/task/skin-tone-analysis" }),
    });
    return;
  }
  req.continue();
});

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

for (const [name, vp] of Object.entries({
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
})) {
  await page.setViewport(vp);
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 800));

  const state = await page.evaluate(() => {
    const fileInput = document.querySelector("input#photo");
    const primary = [...document.querySelectorAll("button")].find((b) => /Measure my skin colours/.test(b.textContent ?? ""));
    const live = [...document.querySelectorAll('[role="radio"]')].find((b) => /^Live measurement$/.test((b.textContent ?? "").trim()));
    return {
      fileInputPresent: Boolean(fileInput),
      fileInputAccept: fileInput?.getAttribute("accept") ?? null,
      liveSelected: live?.getAttribute("aria-checked") ?? null,
      primaryLabel: primary?.textContent?.trim() ?? null,
      primaryDisabled: primary?.disabled ?? null,
      // The primary action must be disabled until a photo is chosen, so it can
      // never post an empty request to a paid endpoint.
      statusLine: /Live: measured now from your photo/.test(document.body.innerText),
      labelTargets: fileInput ? document.querySelectorAll('label[for="photo"]').length : 0,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });

  console.log(`\n[${name}] ${JSON.stringify(state, null, 2)}`);
  const ok = [
    ["photo input rendered", state.fileInputPresent],
    ["photo input accepts jpeg/png", state.fileInputAccept === "image/jpeg,image/png"],
    ["live is the selected mode", state.liveSelected === "true"],
    ["primary action is labelled for live", state.primaryLabel === "Measure my skin colours"],
    ["primary action is disabled until a photo is chosen", state.primaryDisabled === true],
    ["live label is shown", state.statusLine],
    ["the drop zone is bound to the input", state.labelTargets === 1],
    ["no horizontal overflow", state.scrollW <= state.clientW],
  ];
  for (const [label, pass] of ok) console.log(`  ${pass ? "  ok  " : " FAIL "} ${label}`);

  await page.screenshot({ path: `${OUT}/${name}-live-upload.png` });
  await page.screenshot({ path: `${OUT}/${name}-live-upload-full.png`, fullPage: true });
}

console.log(`\nconsole errors: ${errors.length === 0 ? "none" : errors.join(" | ")}`);
await browser.close();
