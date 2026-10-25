/**
 * Drive the live YouCam path through the real UI, as a first-time user would.
 *
 * This is the check that matters for judging: the recorded-sample path is only
 * a fallback, and the live path is the product. It asserts three things the
 * unit tests cannot see, because they are properties of the rendered page:
 *
 *   1. The "Live measurement" control is reachable on load. It was once
 *      `disabled={!canRunLive}`, while the file/URL inputs it reveals only
 *      render after switching modes - so the live path could not be opened at
 *      all, and nothing in the app could be measured live.
 *   2. Choosing a file reveals the file input and enables submit.
 *   3. Submitting runs a real analysis: the result is labelled "measured live
 *      just now" rather than "recorded".
 *
 * Costs 20 units (one skin tone analysis). Not part of `npm test`, which must
 * stay free to run.
 *
 * Usage: node verify-live-path.mjs <baseUrl> [imagePath]
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const IMAGE = process.argv[3] ?? "/tmp/src.jpg";
const CHROME = "/usr/bin/chromium";

if (!existsSync(IMAGE)) {
  console.error(`No photo at ${IMAGE}. Pass one: node verify-live-path.mjs ${BASE} /path/to/face.jpg`);
  process.exit(2);
}

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 420_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle0" });

  const live = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button")].find((b) =>
      /^Live measurement$/i.test((b.textContent ?? "").trim()),
    ),
  );
  const liveHandle = live.asElement();
  check(Boolean(liveHandle), "the Live measurement control exists");
  if (!liveHandle) throw new Error("cannot continue without the live control");
  check(!(await page.evaluate((b) => b.disabled, liveHandle)), "the Live measurement control is enabled on load");

  await liveHandle.click();
  const fileInput = await page
    .waitForSelector("input#photo", { timeout: 10_000 })
    .catch(() => null);
  check(Boolean(fileInput), "choosing live reveals the photo input");
  if (!fileInput) throw new Error("cannot continue without the photo input");

  await fileInput.uploadFile(IMAGE);
  await new Promise((r) => setTimeout(r, 300));

  const submitted = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /^Measure my skin colours$/i.test((b.textContent ?? "").trim()),
    );
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  check(submitted, "submit is enabled once a photo is chosen");

  await page.waitForFunction(() => /step 1/i.test(document.body.innerText), {
    timeout: 240_000,
    polling: 1000,
  }).catch(async () => {
    // Dump what the page actually shows, so a failure is diagnosable instead of
    // a bare timeout. Written next to this script for inspection.
    await page.screenshot({ path: "/tmp/live-path-failure.png", fullPage: false }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    console.error("\n--- no result rendered. Page text (first 1200 chars) ---");
    console.error(text.slice(0, 1200));
    console.error("--- screenshot: /tmp/live-path-failure.png ---\n");
    throw new Error("the analysis result never rendered");
  });

  const text = await page.evaluate(() => document.body.innerText);
  check(
    /measured live just now/i.test(text),
    "the result is labelled as a live measurement",
    /recorded/i.test(text) && !/measured live just now/i.test(text) ? "saw a recorded label instead" : "",
  );
  check(pageErrors.length === 0, "no console or page errors", pageErrors.join("; "));
} finally {
  await browser.close();
}

console.log(failures.length === 0 ? "\nlive path verified" : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
