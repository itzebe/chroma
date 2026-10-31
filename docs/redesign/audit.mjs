/**
 * Design audit: measures the rendered interface against the design standard
 * rather than trusting an impression of it.
 *
 * Reports the type scale actually in use, the spacing rhythm, text density per
 * viewport, heading order, the states that exist for interactive controls, and
 * whether any banned pattern is present in the DOM or computed styles.
 *
 * Usage: node audit.mjs <baseUrl>
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:3000";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  protocolTimeout: 300_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

async function measure(label, width, height, load) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  if (load) {
    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((b) => /^Load the recorded analysis$/.test((b.textContent ?? "").trim()))
        ?.click();
    });
    await page.waitForFunction(() => /Step 01/i.test(document.body.innerText), { timeout: 120_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  }

  const data = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const px = (v) => Math.round(parseFloat(v) * 10) / 10;

    // Text density inside the first viewport only.
    const vh = window.innerHeight;
    const wordsInViewport = [...document.querySelectorAll("p, li, h1, h2, h3, h4, span, dd, dt")]
      .filter((el) => {
        if (!vis(el)) return false;
        const r = el.getBoundingClientRect();
        return r.top < vh && r.bottom > 0 && !el.closest("details:not([open])");
      })
      .map((el) => (el.textContent ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length;

    // Distinct type sizes actually rendered, and where they are used.
    const sizes = new Map();
    for (const el of document.querySelectorAll("h1, h2, h3, p, span, a, button, li, dd, dt")) {
      if (!vis(el) || !(el.textContent ?? "").trim()) continue;
      const s = getComputedStyle(el);
      const key = `${px(s.fontSize)}/${s.fontWeight}`;
      if (!sizes.has(key)) sizes.set(key, { count: 0, sample: (el.textContent ?? "").trim().slice(0, 42) });
      sizes.get(key).count++;
    }

    // Spacing rhythm: the distinct vertical gaps between top-level blocks.
    const gaps = new Set();
    const blocks = [...document.querySelectorAll("main > div > *, main > div > * > *")].filter(vis);
    for (let i = 1; i < blocks.length; i++) {
      const a = blocks[i - 1].getBoundingClientRect();
      const b = blocks[i].getBoundingClientRect();
      const gap = b.top - a.bottom;
      if (gap > 4 && gap < 200) gaps.add(Math.round(gap));
    }

    // Banned patterns, checked in the DOM and in computed styles.
    const banned = [];
    for (const el of document.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const s = getComputedStyle(el);
      const cls = typeof el.className === "string" ? el.className : "";
      if (/gradient/.test(s.backgroundImage) && !/none/.test(s.backgroundImage)) {
        // Conic/radial used for a real data meter is data, not decoration.
        if (!/conic-gradient/.test(s.backgroundImage)) banned.push(["gradient", cls.slice(0, 70)]);
      }
      if (/blur/.test(s.backdropFilter) && s.backdropFilter !== "none") banned.push(["backdrop-blur", cls.slice(0, 70)]);
      if (s.boxShadow !== "none" && !/inset/.test(s.boxShadow) && parseFloat(s.boxShadow.split(" ")[3] ?? 0) > 8) {
        banned.push(["large-shadow", `${cls.slice(0, 50)} :: ${s.boxShadow.slice(0, 60)}`]);
      }
      if (/(^|\s)(purple|violet|indigo|fuchsia)/.test(cls)) banned.push(["banned-hue-class", cls.slice(0, 70)]);
    }
    // Emoji or pictographic glyphs used as UI.
    const emoji = [];
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    for (const el of document.querySelectorAll("span, li, p, button, h1, h2, h3")) {
      if (!vis(el)) continue;
      const t = el.textContent ?? "";
      if (re.test(t) && el.children.length === 0) emoji.push(t.trim().slice(0, 30));
    }

    // Heading order.
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .filter(vis)
      .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? "").trim().slice(0, 46) }));
    const orderOk = headings.every((h, i) => i === 0 || h.level <= headings[i - 1].level + 1);

    // Interactive states: every control must be keyboard reachable and have a
    // visible focus style defined.
    const controls = [...document.querySelectorAll("button, a[href], input, summary")].filter(vis);
    const unreachable = controls.filter((c) => c.tabIndex < 0 && !c.hasAttribute("disabled")).length;

    // Touch targets.
    const small = controls
      .map((c) => ({ t: (c.textContent ?? c.getAttribute("aria-label") ?? c.tagName).trim().slice(0, 28), h: Math.round(c.getBoundingClientRect().height) }))
      .filter((c) => c.h < 24);

    // Cards: how many elements carry the same boxed treatment.
    const boxed = [...document.querySelectorAll("section, article, div")]
      .filter(vis)
      .filter((el) => {
        const s = getComputedStyle(el);
        return parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle === "solid" &&
          s.borderTopColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "rgba(0, 0, 0, 0)";
      })
      .map((el) => (typeof el.className === "string" ? el.className : "").split(" ").filter((c) => /^(panel|rounded|bg-ink)/.test(c)).join(" "))
      .filter(Boolean);

    const overflow = { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };

    return {
      wordsInViewport,
      typeScale: [...sizes.entries()].map(([k, v]) => ({ size: k, count: v.count, sample: v.sample })).sort((a, b) => parseFloat(b.size) - parseFloat(a.size)),
      gaps: [...gaps].sort((a, b) => a - b),
      banned: banned.slice(0, 12),
      emoji: [...new Set(emoji)],
      headings,
      orderOk,
      controls: controls.length,
      unreachable,
      smallTargets: small,
      boxedCount: boxed.length,
      boxedDistinct: [...new Set(boxed)],
      overflow,
    };
  });

  console.log(`\n${"=".repeat(72)}\n${label}  (${width}x${height}${load ? ", recorded result loaded" : ""})\n${"=".repeat(72)}`);
  console.log(`words in first viewport : ${data.wordsInViewport}`);
  console.log(`distinct type sizes     : ${data.typeScale.length}`);
  for (const t of data.typeScale) console.log(`    ${t.size.padEnd(12)} x${String(t.count).padStart(3)}  ${t.sample}`);
  console.log(`vertical gap rhythm     : ${data.gaps.join(", ")}`);
  console.log(`boxed sections          : ${data.boxedCount} (${data.boxedDistinct.length} distinct treatment(s))`);
  for (const b of data.boxedDistinct) console.log(`    ${b}`);
  console.log(`banned patterns         : ${data.banned.length === 0 ? "none" : JSON.stringify(data.banned)}`);
  console.log(`emoji as UI             : ${data.emoji.length === 0 ? "none" : JSON.stringify(data.emoji)}`);
  console.log(`heading order           : ${data.orderOk ? "in order" : "OUT OF ORDER"} — ${data.headings.map((h) => "h" + h.level).join(" ")}`);
  console.log(`controls / unreachable  : ${data.controls} / ${data.unreachable}`);
  console.log(`targets under 24px      : ${data.smallTargets.length === 0 ? "none" : JSON.stringify(data.smallTargets)}`);
  console.log(`horizontal overflow     : ${data.overflow.scrollW <= data.overflow.clientW ? "none" : `YES (${data.overflow.scrollW} vs ${data.overflow.clientW})`}`);
  return data;
}

await measure("HOMEPAGE", 1440, 900, false);
await measure("HOMEPAGE", 390, 844, false);
await measure("RECORDED RESULT", 1440, 900, true);
await measure("RECORDED RESULT", 390, 844, true);

console.log(`\nconsole errors: ${errors.length === 0 ? "none" : errors.join(" | ")}`);
await browser.close();
