/**
 * WCAG 2.2 AA audit with axe-core, run against the real rendered app.
 *
 * Runs on the homepage and on the loaded recorded result, at desktop and Android
 * sizes. Reports violations with the failing nodes so they can be fixed rather
 * than argued about.
 *
 * Usage: node a11y.mjs <baseUrl>
 */
import puppeteer from "puppeteer-core";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BASE = process.argv[2] ?? "http://localhost:3000";
const AXE = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const CHROME = "/usr/bin/chromium";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 300_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const results = [];
let totalViolations = 0;

async function audit(label, width, height, load) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120_000 });
  if (load) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        /^Load the recorded analysis$/i.test((b.textContent ?? "").trim()),
      );
      btn?.click();
    });
    await page.waitForFunction(() => /Step 01/i.test(document.body.innerText), { timeout: 120_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  }
  await page.evaluate(AXE);
  const res = await page.evaluate(async () =>
    // @ts-expect-error injected at runtime
    await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    }),
  );
  const violations = res.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 4).map((n) => ({
      target: n.target.join(" "),
      summary: (n.failureSummary ?? "").split("\n").slice(0, 3).join(" "),
    })),
  }));
  totalViolations += violations.length;
  results.push({ label, viewport: `${width}x${height}`, violations, passes: res.passes.length });
  console.log(`${violations.length === 0 ? "  ok  " : " FAIL "} ${label} (${width}x${height}) — ${violations.length} violation(s), ${res.passes.length} checks passed`);
  for (const v of violations) {
    console.log(`        [${v.impact}] ${v.id}: ${v.help}`);
    for (const n of v.nodes) console.log(`          ${n.target} :: ${n.summary}`);
  }
  await page.close();
}

await audit("homepage", 1440, 900, false);
await audit("homepage", 390, 844, false);
await audit("recorded result", 1440, 900, true);
await audit("recorded result", 390, 844, true);

await browser.close();
console.log(`\n${totalViolations === 0 ? "no WCAG 2.2 AA violations" : `${totalViolations} violation type(s) found`}`);
process.exit(totalViolations === 0 ? 0 : 1);
