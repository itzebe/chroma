/**
 * Garment and product-matching tests.
 *
 * These pin the commercial behaviour: a colour taken from the person's own season
 * palette must be rated excellent, a colour from the opposite family must be rated
 * challenging, and the advice must always name a concrete next action.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/lib/season.ts";
import {
  evaluateGarment,
  suggestPairings,
  suggestAlternative,
  nudgeTowardSeason,
  GARMENT_THRESHOLDS,
} from "../src/lib/garment.ts";
import {
  matchShades,
  bestMatchPerCategory,
  validateLibrary,
  readableTextOn,
  ALL_SHADES,
  PRODUCT_LIBRARY,
  type ProductCategory,
} from "../src/lib/products.ts";
import { deltaEHex, hexToLab, parseHex, contrastRatio } from "../src/lib/color.ts";

const LIVE = {
  skin_color: "#ba8e6e",
  lip_color: "#c98e93",
  eye_color: "#553829",
  eyebrow_color: "#3e3834",
};

const liveProfile = classify({ colors: LIVE, quality: { frontal: "good", lighting: "good" } });
const warmProfile = classify({ colors: { skin_color: "#f7e3c8", lip_color: "#e8907a", eye_color: "#8a9a5b", eyebrow_color: "#a08a6a" }, quality: {} });
const coolProfile = classify({ colors: { skin_color: "#5c3d33", lip_color: "#9c5a70", eye_color: "#2a3a55", eyebrow_color: "#2a2622" }, quality: {} });

// --- garment harmony --------------------------------------------------------

test("a palette colour is always rated excellent for that person", () => {
  for (const profile of [liveProfile, warmProfile, coolProfile]) {
    for (const entry of profile.season.palette) {
      const advice = evaluateGarment(entry.hex, profile)!;
      assert.ok(advice, `${profile.seasonId}: no advice for palette colour ${entry.hex}`);
      assert.equal(
        advice.verdict,
        "excellent",
        `${profile.seasonId}: palette colour ${entry.name} rated ${advice.verdict} (distance ${advice.distance.toFixed(1)})`,
      );
      assert.ok(advice.distance <= GARMENT_THRESHOLDS.excellent);
    }
  }
});

test("an avoid colour is never rated excellent", () => {
  for (const profile of [liveProfile, warmProfile, coolProfile]) {
    for (const bad of profile.season.avoid) {
      const advice = evaluateGarment(bad.hex, profile)!;
      assert.notEqual(
        advice.verdict,
        "excellent",
        `${profile.seasonId}: avoid colour ${bad.name} (${bad.hex}) must not be excellent`,
      );
    }
  }
});

test("the avoid rule can only soften a verdict by exactly one step, never improve it", () => {
  // The verdict comes from the CIEDE2000 distance to the nearest palette colour,
  // and is then softened by AT MOST one step when the colour is closer to an
  // "avoid" swatch than to a palette swatch. Rather than infer that from a
  // sorted list (where a distance step and a softening step are indistinguishable),
  // recompute the distance-based verdict independently and compare.
  const order = ["excellent", "good", "workable", "challenging"] as const;

  const baseVerdict = (distance: number): (typeof order)[number] => {
    if (distance <= GARMENT_THRESHOLDS.excellent) return "excellent";
    if (distance <= GARMENT_THRESHOLDS.good) return "good";
    if (distance <= GARMENT_THRESHOLDS.workable) return "workable";
    return "challenging";
  };

  const samples = [
    "#ffffff", "#f0f0f0", "#c0c0c0", "#808080", "#404040", "#000000",
    "#00ff00", "#ff00ff", "#ff0000", "#0000ff", "#7b1e3a", "#ba8e6e",
    ...liveProfile.season.palette.map((p) => p.hex),
    ...liveProfile.season.avoid.map((a) => a.hex),
  ];

  for (const hex of samples) {
    const advice = evaluateGarment(hex, liveProfile)!;
    const base = baseVerdict(advice.distance);
    const delta = order.indexOf(advice.verdict) - order.indexOf(base);
    assert.ok(
      delta === 0 || delta === 1,
      `${hex}: distance ${advice.distance.toFixed(1)} implies "${base}" but got "${advice.verdict}" (delta ${delta})`,
    );
    assert.ok(delta >= 0, `${hex}: the avoid rule must never make a verdict more favourable`);
  }
});

test("the distance-based verdict is monotonic in distance", () => {
  const order = ["excellent", "good", "workable", "challenging"];
  const samples = ["#ffffff", "#f0f0f0", "#c0c0c0", "#808080", "#404040", "#000000", "#00ff00", "#ff00ff"];
  const rows = samples
    .map((hex) => ({ hex, distance: evaluateGarment(hex, liveProfile)!.distance }))
    .sort((a, b) => a.distance - b.distance);
  let previous = 0;
  for (const row of rows) {
    const base =
      row.distance <= GARMENT_THRESHOLDS.excellent
        ? 0
        : row.distance <= GARMENT_THRESHOLDS.good
          ? 1
          : row.distance <= GARMENT_THRESHOLDS.workable
            ? 2
            : 3;
    assert.ok(base >= previous, `${row.hex}: distance ${row.distance.toFixed(1)} gave a better class`);
    previous = base;
    assert.ok(order[base]);
  }
});

test("every verdict names a concrete next action", () => {
  const samples = ["#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff", "#ba8e6e", "#7b1e3a"];
  for (const hex of samples) {
    const advice = evaluateGarment(hex, liveProfile)!;
    assert.ok(advice.advice.length > 20, `${hex}: advice too short`);
    assert.match(advice.headline, new RegExp(liveProfile.season.name));
    assert.match(advice.detail, /CIEDE2000/);
    if (advice.verdict !== "excellent") {
      assert.ok(advice.pairing, `${hex}: non-excellent verdict must suggest a pairing`);
      assert.ok(hexToLab(advice.pairing!.hex));
    }
  }
});

test("invalid garment colour returns null instead of a fabricated verdict", () => {
  assert.equal(evaluateGarment("not-a-color", liveProfile), null);
  assert.equal(evaluateGarment("", liveProfile), null);
});

test("suggestPairings returns a visible lightness step", () => {
  const pairs = suggestPairings("#7b1e3a", liveProfile);
  assert.ok(pairs.pairs.length > 0);
  assert.ok(pairs.pairs.length <= 3);
  assert.match(pairs.reason, /lightness step/);
  const garmentL = hexToLab("#7b1e3a")!.L;
  for (const p of pairs.pairs) {
    const dL = Math.abs(hexToLab(p.hex)!.L - garmentL);
    assert.ok(dL >= 12, `pair ${p.name} only ${dL.toFixed(1)} L* away, not a clear contrast step`);
  }
});

test("suggestAlternative moves a poor colour into the palette", () => {
  const alt = suggestAlternative("#00ff00", liveProfile);
  assert.ok(hexToLab(alt.hex));
  const advice = evaluateGarment(alt.hex, liveProfile)!;
  assert.equal(advice.verdict, "excellent", "the suggested alternative must itself be excellent");
});

test("nudgeTowardSeason walks progressively closer to the palette", () => {
  const steps = nudgeTowardSeason("#00ff00", liveProfile, 4);
  assert.equal(steps.length, 4);
  const start = deltaEHex("#00ff00", suggestAlternative("#00ff00", liveProfile).hex)!;
  const distances = steps.map((s) => deltaEHex(s, suggestAlternative("#00ff00", liveProfile).hex)!);
  for (let i = 1; i < distances.length; i++) {
    assert.ok(distances[i] <= distances[i - 1] + 1e-6, "nudge must not move away from the target");
  }
  assert.ok(distances[distances.length - 1] < start);
});

// --- product shade matching -------------------------------------------------

test("the shade library itself is valid", () => {
  assert.deepEqual(validateLibrary(), []);
});

test("every category has a usable spread of shades", () => {
  for (const [cat, shades] of Object.entries(PRODUCT_LIBRARY)) {
    assert.ok(shades.length >= 5, `${cat} has only ${shades.length} shades`);
    const lightness = shades.map((s) => hexToLab(s.hex)!.L);
    assert.ok(
      Math.max(...lightness) - Math.min(...lightness) > 25,
      `${cat} shades do not span enough lightness`,
    );
  }
});

test("shade names avoid third-party trademarks", () => {
  // The hackathon forbids third-party trademarks in the submission. Guard the
  // library against a brand name being pasted in later.
  const banned = [
    "fenty", "mac ", "nars", "charlotte", "dior", "chanel", "estee", "lancome",
    "maybelline", "loreal", "nyx", "sephora", "clinique", "shiseido", "guerlain",
    "ysl", "ysl", "armani", "givenchy", "benefit", "tarte", "hourglass", "rare beauty",
  ];
  for (const shade of ALL_SHADES) {
    const lower = shade.name.toLowerCase();
    for (const brand of banned) {
      assert.ok(!lower.includes(brand.trim()), `shade "${shade.name}" appears to use a brand name`);
    }
  }
});

test("foundation matching returns the measured skin tone's own shade", () => {
  for (const [hex, label] of [
    ["#f7e3c8", "ivory warm"],
    ["#c99a6b", "golden tan"],
    ["#8a5a3b", "bronze"],
    ["#43291f", "ebony"],
  ] as const) {
    const profile = classify({ colors: { skin_color: hex }, quality: {} });
    const best = matchShades("foundation", profile, { limit: 1 })[0];
    assert.ok(best, `${label}: no foundation match`);
    assert.ok(
      best.grade === "excellent" || best.grade === "good",
      `${label} (${hex}): best foundation graded ${best.grade} at distance ${best.distance.toFixed(1)}`,
    );
    assert.ok(best.shade.hex.toLowerCase() === hex || best.distance < 8);
  }
});

test("foundation weighting prefers correct depth over correct hue", () => {
  const profile = classify({ colors: { skin_color: "#c99a6b" }, quality: {} });
  const ranked = matchShades("foundation", profile);
  assert.ok(ranked.length > 0);
  // The winner must be within a small lightness error of the skin.
  const skinL = hexToLab("#c99a6b")!.L;
  const bestL = hexToLab(ranked[0].shade.hex)!.L;
  assert.ok(
    Math.abs(bestL - skinL) < 6,
    `best foundation is ${Math.abs(bestL - skinL).toFixed(1)} L* off the measured skin`,
  );
});

test("matches are sorted by distance and graded consistently", () => {
  for (const category of ["foundation", "lipstick", "blush", "eyeshadow"] as ProductCategory[]) {
    const matches = matchShades(category, liveProfile);
    assert.ok(matches.length > 0, `${category}: no matches`);
    for (let i = 1; i < matches.length; i++) {
      assert.ok(matches[i].distance >= matches[i - 1].distance, `${category}: not sorted`);
    }
    for (const m of matches) {
      assert.ok(m.score >= 0 && m.score <= 100, `${category}: score ${m.score} out of range`);
      assert.ok(m.reason.length > 0 && m.direction.length > 0);
    }
  }
});

test("minGrade filtering is respected", () => {
  const onlyGood = matchShades("lipstick", liveProfile, { minGrade: "good" });
  for (const m of onlyGood) {
    assert.ok(m.grade === "excellent" || m.grade === "good", `got ${m.grade}`);
  }
  assert.ok(onlyGood.length <= matchShades("lipstick", liveProfile).length);
});

test("a missing measurement yields no matches rather than wrong ones", () => {
  // Only skin measured: lipstick and eyeshadow have nothing to match against.
  const skinOnly = classify({ colors: { skin_color: "#ba8e6e" }, quality: {} });
  assert.equal(matchShades("lipstick", skinOnly).length, 0);
  assert.equal(matchShades("eyeshadow", skinOnly).length, 0);
  assert.ok(matchShades("foundation", skinOnly).length > 0);
});

test("different people get different best matches", () => {
  const a = bestMatchPerCategory(liveProfile);
  const b = bestMatchPerCategory(coolProfile);
  const aIds = a.map((x) => x.match.shade.id).join(",");
  const bIds = b.map((x) => x.match.shade.id).join(",");
  assert.notEqual(aIds, bIds, "two very different profiles should not get identical matches");
});

test("bestMatchPerCategory covers every category with a measurement", () => {
  const best = bestMatchPerCategory(liveProfile);
  assert.equal(best.length, 4);
  for (const { category, match } of best) {
    assert.equal(match.shade.category, category);
  }
});

test("readableTextOn always meets WCAG AA contrast", () => {
  for (const shade of ALL_SHADES) {
    const fg = readableTextOn(shade.hex);
    const ratio = contrastRatio(parseHex(shade.hex)!, parseHex(fg)!);
    assert.ok(ratio >= 4.5, `${shade.name} ${shade.hex} on ${fg} is only ${ratio.toFixed(2)}:1`);
  }
  assert.equal(readableTextOn("not-a-color"), "#000000");
});

test("matching is deterministic", () => {
  for (const category of ["foundation", "lipstick", "blush", "eyeshadow"] as ProductCategory[]) {
    assert.equal(
      JSON.stringify(matchShades(category, liveProfile)),
      JSON.stringify(matchShades(category, liveProfile)),
    );
  }
});

test("garment advice is deterministic", () => {
  assert.equal(
    JSON.stringify(evaluateGarment("#7b1e3a", liveProfile)),
    JSON.stringify(evaluateGarment("#7b1e3a", liveProfile)),
  );
});

test("foundation ranking is driven by perceptual distance plus a depth weighting", () => {
  // The top match for warm skin #ba8e6e is #b09280: same lightness (dL 0.4) and
  // lower chroma. That is a correct neutral match, not a clash - an earlier test
  // asserted otherwise and was wrong. What must hold is that the winner really is
  // the closest by the documented score.
  const profile = classify({ colors: { skin_color: "#ba8e6e" }, quality: {} });
  const ranked = matchShades("foundation", profile);
  const best = ranked[0];
  for (const m of ranked) {
    assert.ok(m.distance >= best.distance - 1e-9, `${m.shade.name} scored better than the reported best`);
  }
  assert.ok(Math.abs(hexToLab(best.shade.hex)!.L - hexToLab("#ba8e6e")!.L) < 6, "the best match must be at the right depth");
});

test("a shade from a different hue family is flagged as a caution", () => {
  // The undertone risk is a hue-family mismatch, which is surfaced as a caution
  // rather than folded into the score.
  const warmSkin = classify({ colors: { skin_color: "#ba8e6e" }, quality: {} });
  const ranked = matchShades("foundation", warmSkin);
  const coolRose = ranked.find((m) => m.shade.id === "f-16")!;
  assert.ok(coolRose, "the cool foundation should be in the ranking");
  assert.ok(coolRose.caution, "a cool-rose shade against warm skin should carry a caution");
  assert.match(coolRose.caution!, /leans the other way/);
  // The best match must not carry a hue caution.
  assert.equal(ranked[0].caution, null, "the top match should not be a hue clash");
});

test("no match leads with a shade whose hue family is unrelated", () => {
  for (const skin of ["#f7e3c8", "#e0c3a8", "#ba8e6e", "#8a5a3b", "#43291f"]) {
    const profile = classify({ colors: { skin_color: skin }, quality: {} });
    const top = matchShades("foundation", profile, { limit: 1 })[0];
    assert.equal(
      top.caution,
      null,
      `${skin}: the top foundation match ${top.shade.name} is flagged as a hue clash`,
    );
  }
});

test("every shade match exposes a caution field", () => {
  for (const category of ["foundation", "lipstick", "blush", "eyeshadow"] as ProductCategory[]) {
    for (const m of matchShades(category, liveProfile)) {
      assert.ok(m.caution === null || typeof m.caution === "string");
    }
  }
});
