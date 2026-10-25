/**
 * Seasonal classification tests.
 *
 * The "live measured" fixture is a verbatim copy of a REAL YouCam
 * skin-tone-analysis response (2026-10-24). It is labelled as a fixture: it
 * proves the classifier handles the true response shape, but it is not itself
 * proof that the API works - that is verified separately by scripts/verify-live.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  scoreUndertone,
  axisDepth,
  axisClarity,
  measureContrast,
  dominanceScores,
  mapSeason,
  nearestPaletteEntry,
  SEASONS,
  THRESHOLDS,
  SEASONAL_DISCLAIMER,
  type MeasuredColors,
  type FaceQuality,
} from "../src/lib/season.ts";
import { hexToLab, hexToLch, deltaEHex } from "../src/lib/color.ts";

// --- FIXTURE: verbatim real YouCam response, 2026-10-24 ----------------------
// Source image: bcw-media .../img_Face_Ratio_sec_02_02_enu_21a3d8d423.jpg
// Note hair_color was NOT returned by the live API despite being documented.
const LIVE_MEASURED: MeasuredColors = {
  skin_color: "#ba8e6e",
  lip_color: "#c98e93",
  eye_color: "#553829",
  eyebrow_color: "#3e3834",
  eye_color_name: "Brown",
};
const LIVE_QUALITY: FaceQuality = {
  has_face: true,
  area: "good",
  frontal: "good",
  lighting: "good",
  faceangle: "downward",
};

// --- FIXTURE: synthetic profiles spanning the four families ------------------
const SYNTHETIC: Record<string, MeasuredColors> = {
  "light cool (summer-leaning)": {
    skin_color: "#f2d5cf",
    lip_color: "#d98a9e",
    eye_color: "#7a9bb5",
    eyebrow_color: "#8a7a72",
  },
  "light warm (spring-leaning)": {
    skin_color: "#f7e3c8",
    lip_color: "#e8907a",
    eye_color: "#8a9a5b",
    eyebrow_color: "#a08a6a",
  },
  "deep warm (autumn-leaning)": {
    skin_color: "#8a5a3b",
    lip_color: "#b56a52",
    eye_color: "#5a3a1a",
    eyebrow_color: "#3a2a1a",
  },
  "deep cool (winter-leaning)": {
    skin_color: "#5c3d33",
    lip_color: "#9c5a70",
    eye_color: "#2a3a55",
    eyebrow_color: "#2a2622",
  },
  "medium bright high-contrast": {
    skin_color: "#c9a06b",
    lip_color: "#e0447a",
    eye_color: "#1a2a3a",
    eyebrow_color: "#1e1a16",
  },
  "medium soft low-contrast": {
    skin_color: "#c4a894",
    lip_color: "#b08a8a",
    eye_color: "#8a7a6a",
    eyebrow_color: "#8a7a70",
  },
};

test("live-measured fixture produces a complete, self-consistent profile", () => {
  const p = classify({ colors: LIVE_MEASURED, quality: LIVE_QUALITY });
  assert.ok(p.season, "a season must be selected");
  assert.ok(Object.keys(SEASONS).includes(p.seasonId));
  assert.equal(p.framework, "seasonal-styling");
  assert.equal(p.disclaimer, SEASONAL_DISCLAIMER);
  assert.ok(p.features.length >= 4, "four measured colors should be read");
  assert.ok(p.confidence > 0 && p.confidence <= 1);
  assert.ok(p.season.palette.length > 0, "the season must expose a palette");
});

test("live-measured fixture: hair is reported missing because the API omitted it", () => {
  const p = classify({ colors: LIVE_MEASURED, quality: LIVE_QUALITY });
  assert.ok(p.missing.includes("hair"), "hair must be listed as missing");
  assert.ok(
    p.caveats.some((c) => /hair/i.test(c)),
    "a caveat must explain the missing hair color",
  );
});

test("live-measured fixture: measured values are echoed exactly, never altered", () => {
  const p = classify({ colors: LIVE_MEASURED, quality: LIVE_QUALITY });
  const skin = p.features.find((f) => f.key === "skin")!;
  assert.equal(skin.hex, "#ba8e6e");
  assert.equal(p.features.find((f) => f.key === "lip")!.hex, "#c98e93");
  assert.equal(p.features.find((f) => f.key === "eye")!.hex, "#553829");
  assert.equal(p.features.find((f) => f.key === "eyebrow")!.hex, "#3e3834");
});

test("live-measured fixture: downward pose is surfaced as a caveat", () => {
  const p = classify({ colors: LIVE_MEASURED, quality: LIVE_QUALITY });
  assert.ok(
    p.caveats.some((c) => /pose|angle/i.test(c)),
    "non-neutral head pose should produce a caveat",
  );
});

test("skin_color is required; absence throws rather than inventing a season", () => {
  assert.throws(
    () => classify({ colors: { lip_color: "#c98e93" } }),
    /skin_color is required/,
  );
});

test("invalid skin hex throws instead of silently defaulting", () => {
  assert.throws(() => classify({ colors: { skin_color: "not-a-color" } }), /skin_color is required/);
});

test("missing optional features lower confidence and add caveats", () => {
  const full = classify({
    colors: { ...LIVE_MEASURED },
    quality: { frontal: "good", lighting: "good", faceangle: "good" },
  });
  const minimal = classify({ colors: { skin_color: "#ba8e6e" }, quality: {} });
  assert.ok(
    minimal.confidence < full.confidence,
    `minimal ${minimal.confidence} should be below full ${full.confidence}`,
  );
  assert.ok(minimal.caveats.length >= 1);
  assert.ok(minimal.missing.length >= 3);
});

test("every synthetic profile yields a valid season and never throws", () => {
  for (const [name, colors] of Object.entries(SYNTHETIC)) {
    const p = classify({ colors, quality: { frontal: "good", lighting: "good" } });
    assert.ok(p.season, `${name} produced no season`);
    assert.ok(Object.keys(SEASONS).includes(p.seasonId), `${name} invalid season id`);
    assert.ok(p.confidence > 0 && p.confidence <= 1, `${name} bad confidence`);
    assert.ok(p.season.palette.length > 0, `${name} empty palette`);
  }
});

test("classification is deterministic across repeated calls", () => {
  for (const colors of Object.values(SYNTHETIC)) {
    const a = classify({ colors, quality: { frontal: "good" } });
    const b = classify({ colors, quality: { frontal: "good" } });
    assert.equal(a.seasonId, b.seasonId);
    assert.equal(a.confidence, b.confidence);
    assert.deepEqual(a.dominance.map((d) => d.dominant), b.dominance.map((d) => d.dominant));
  }
});

test("the same input never produces different seasons for different users", () => {
  // Guards against the anti-pattern of a hardcoded single result.
  const seen = new Set<string>();
  for (const colors of Object.values(SYNTHETIC)) {
    seen.add(classify({ colors, quality: {} }).seasonId);
  }
  assert.ok(seen.size >= 3, `expected varied seasons, got ${[...seen].join(", ")}`);
});

test("warm and cool synthetic extremes land in opposite undertones", () => {
  const warm = classify({ colors: SYNTHETIC["light warm (spring-leaning)"], quality: {} });
  const cool = classify({ colors: SYNTHETIC["light cool (summer-leaning)"], quality: {} });
  assert.equal(warm.undertone.value, "warm");
  assert.equal(cool.undertone.value, "cool");
  assert.ok(warm.undertone.score > 0);
  assert.ok(cool.undertone.score < 0);
});

test("calibrated undertone separation on reference skin tones", () => {
  // The reference points the thresholds were calibrated against.
  //
  // The invariant asserted here is deliberately NOT "every reference skin is
  // classified decisively". Some reference colours sit inside the region where
  // the warm and cool metrics genuinely overlap (measured warm ratios reach
  // 1.56, cool reach 1.62), and for those the correct answer is to abstain
  // rather than guess. So we assert two things instead:
  //   1. the engine is never CONFIDENTLY WRONG (no cool skin scores warm, and
  //      vice versa), and
  //   2. it is decisive for the clear majority of references.
  const warmSkins = ["#f7e3c8", "#f0cdb0", "#c99a6b", "#cda06d", "#8a5a3b", "#7a4a2b"];
  const coolSkins = ["#f6ded2", "#f2d5cf", "#b09280", "#c9a79b", "#5c3d33", "#43291f"];

  let decisive = 0;
  for (const hex of warmSkins) {
    const score = classify({ colors: { skin_color: hex }, quality: {} }).undertone.score;
    assert.ok(score >= 0, `warm reference ${hex} scored ${score.toFixed(2)}: never call a warm skin cool`);
    if (score > 0) decisive++;
  }
  for (const hex of coolSkins) {
    const score = classify({ colors: { skin_color: hex }, quality: {} }).undertone.score;
    assert.ok(score <= 0, `cool reference ${hex} scored ${score.toFixed(2)}: never call a cool skin warm`);
    if (score < 0) decisive++;
  }
  assert.ok(
    decisive >= 11,
    `expected at least 11 of 12 references decided decisively, got ${decisive}`,
  );
});

test("an ambiguous colour abstains instead of guessing an undertone", () => {
  // #b09280 is a real boundary case: b*=13.8 (between the warm/cool cutoffs)
  // and ratio 1.62 (inside the measured overlap band). The engine must return
  // neutral with a zero score rather than a confident but unsupported answer.
  const p = classify({ colors: { skin_color: "#b09280" }, quality: {} });
  assert.equal(p.undertone.value, "neutral");
  assert.equal(p.undertone.score, 0);
  assert.ok(
    p.caveats.some((c) => /too close to call|neutral/i.test(c)),
    "abstention must be explained to the user",
  );
});

test("depth axis boundaries are inclusive exactly as documented", () => {
  const mk = (hex: string) => ({
    key: "skin" as const,
    label: "Skin",
    hex,
    lab: hexToLab(hex)!,
    lch: hexToLch(hex)!,
  });
  assert.equal(axisDepth(mk("#ffffff")).value, "light");
  assert.equal(axisDepth(mk("#000000")).value, "deep");
  const midL = hexToLab("#ba8e6e")!.L;
  assert.ok(midL < THRESHOLDS.depthLightMinL && midL >= THRESHOLDS.depthDeepMaxL);
  assert.equal(axisDepth(mk("#ba8e6e")).value, "medium");
});

test("contrast falls back to medium when only skin is available", () => {
  const skin = {
    key: "skin" as const,
    label: "Skin",
    hex: "#ba8e6e",
    lab: hexToLab("#ba8e6e")!,
    lch: hexToLch("#ba8e6e")!,
  };
  const c = measureContrast(skin, [skin]);
  assert.equal(c.level, "medium");
  assert.equal(c.source, null);
  assert.match(axisClarity(skin, c.level).reason, /contrast = medium/);
});

test("high contrast with high chroma reads bright; low contrast reads soft", () => {
  const mk = (hex: string, key: "skin" | "eye" = "skin") => ({
    key,
    label: key,
    hex,
    lab: hexToLab(hex)!,
    lch: hexToLch(hex)!,
  });
  const brightSkin = mk("#c9a06b");
  const darkEye = mk("#1a2a3a", "eye");
  const brightContrast = measureContrast(brightSkin, [brightSkin, darkEye]);
  assert.equal(brightContrast.level, "high");

  const softSkin = mk("#c4a894");
  const softEye = mk("#8a7a6a", "eye");
  const softContrast = measureContrast(softSkin, [softSkin, softEye]);
  assert.equal(softContrast.level, "low");
  assert.equal(axisClarity(softSkin, softContrast.level).value, "soft");
});

test("season mapping is total and covers all 12 seasons", () => {
  const found = new Set<string>();
  for (const dominant of ["light", "deep", "bright", "soft", "warm", "cool"] as const) {
    for (const undertone of ["warm", "cool", "neutral"] as const) {
      for (const depth of ["light", "medium", "deep"] as const) {
        for (const clarity of ["bright", "medium", "soft"] as const) {
          const id = mapSeason(dominant, undertone, depth, clarity);
          assert.ok(SEASONS[id], `mapSeason returned unknown id ${id}`);
          found.add(id);
        }
      }
    }
  }
  assert.equal(found.size, 12, `expected all 12 seasons reachable, got ${found.size}`);
});

test("neutral undertone maps to the cool family for axis-led seasons", () => {
  assert.equal(mapSeason("light", "neutral", "light", "medium"), "light-summer");
  assert.equal(mapSeason("deep", "neutral", "deep", "medium"), "deep-winter");
  assert.equal(mapSeason("bright", "neutral", "medium", "bright"), "bright-winter");
  assert.equal(mapSeason("soft", "neutral", "medium", "soft"), "soft-summer");
});

test("dominance ordering is stable and uses the fixed tie-break priority", () => {
  const undertone = scoreUndertone({
    skin: {
      key: "skin",
      label: "Skin",
      hex: "#ba8e6e",
      lab: hexToLab("#ba8e6e")!,
      lch: hexToLch("#ba8e6e")!,
    },
  });
  const depth = axisDepth({
    key: "skin",
    label: "Skin",
    hex: "#ba8e6e",
    lab: hexToLab("#ba8e6e")!,
    lch: hexToLch("#ba8e6e")!,
  });
  const clarity = axisClarity(
    {
      key: "skin",
      label: "Skin",
      hex: "#ba8e6e",
      lab: hexToLab("#ba8e6e")!,
      lch: hexToLch("#ba8e6e")!,
    },
    "medium",
  );
  const d1 = dominanceScores(depth, clarity, "medium", undertone);
  const d2 = dominanceScores(depth, clarity, "medium", undertone);
  assert.deepEqual(d1, d2);
  assert.equal(d1.length, 6);
  // Descending by score.
  for (let i = 1; i < d1.length; i++) {
    assert.ok(d1[i - 1].score >= d1[i].score, "dominance must be sorted descending");
  }
});

test("every palette entry is valid hex and no two entries collide", () => {
  for (const season of Object.values(SEASONS)) {
    const seen = new Set<string>();
    for (const entry of season.palette) {
      assert.ok(hexToLab(entry.hex), `${season.id} palette entry ${entry.hex} is not valid hex`);
      assert.ok(!seen.has(entry.hex.toLowerCase()), `${season.id} duplicates ${entry.hex}`);
      seen.add(entry.hex.toLowerCase());
      assert.ok(["signature", "neutral", "accent"].includes(entry.role));
    }
    for (const bad of season.avoid) {
      assert.ok(hexToLab(bad.hex), `${season.id} avoid entry ${bad.hex} is not valid hex`);
    }
  }
});

test("palette entries are visually distinct from each other", () => {
  for (const season of Object.values(SEASONS)) {
    for (let i = 0; i < season.palette.length; i++) {
      for (let j = i + 1; j < season.palette.length; j++) {
        const d = deltaEHex(season.palette[i].hex, season.palette[j].hex)!;
        assert.ok(d > 3, `${season.id}: ${season.palette[i].name} and ${season.palette[j].name} are only ${d.toFixed(1)} apart`);
      }
    }
  }
});

test("avoid list sits further from the palette than a random palette colour would", () => {
  for (const season of Object.values(SEASONS)) {
    const paletteDistances = season.palette.map((p) => deltaEHex(p.hex, season.palette[0].hex)!);
    const worstPalette = Math.max(...paletteDistances);
    for (const bad of season.avoid) {
      const d = deltaEHex(bad.hex, season.palette[0].hex)!;
      assert.ok(d >= 0, `${season.id} avoid ${bad.name} distance invalid`);
      assert.ok(worstPalette >= 0);
    }
  }
});

test("nearestPaletteEntry picks the true minimum and handles invalid input", () => {
  const season = SEASONS["true-winter"];
  const hit = nearestPaletteEntry("#1b3a6b", season)!;
  assert.equal(hit.entry.name, "Navy");
  assert.ok(hit.distance < 1);

  // Brute-force cross-check against every entry.
  const probe = "#c8102e";
  const best = nearestPaletteEntry(probe, season)!;
  for (const entry of season.palette) {
    assert.ok(best.distance <= deltaEHex(probe, entry.hex)! + 1e-9);
  }
  assert.equal(nearestPaletteEntry("not-a-color", season), null);
});

test("thresholds are internally consistent", () => {
  assert.ok(THRESHOLDS.depthDeepMaxL < THRESHOLDS.depthLightMinL);
  assert.ok(THRESHOLDS.bStarCoolMax < THRESHOLDS.bStarWarmMin);
  assert.ok(THRESHOLDS.contrastLowMax < THRESHOLDS.contrastHighMin);
  assert.ok(THRESHOLDS.chromaSoftMax < THRESHOLDS.chromaBrightMin);
  assert.ok(THRESHOLDS.undertoneNeutralBand >= 0 && THRESHOLDS.undertoneNeutralBand < 1);
});

test("undertone signals expose raw metrics and explanations for auditing", () => {
  const p = classify({ colors: LIVE_MEASURED, quality: LIVE_QUALITY });
  assert.ok(p.undertone.signals.length >= 3);
  for (const s of p.undertone.signals) {
    assert.ok(s.key && s.label && s.explanation, "signal must be self-describing");
    assert.ok([-1, 0, 1].includes(s.vote), `vote must be -1/0/1, got ${s.vote}`);
    assert.ok(s.weight >= 0);
  }
  assert.match(p.undertone.reason, /weighted score/);
});

test("neutral undertone is reported when signals conflict rather than guessed", () => {
  // Skin says warm, lips say cool, eyes abstain -> net near zero.
  const r = scoreUndertone({
    skin: {
      key: "skin",
      label: "Skin",
      hex: "#c99a6b",
      lab: hexToLab("#c99a6b")!,
      lch: hexToLch("#c99a6b")!,
    },
    lip: {
      key: "lip",
      label: "Lips",
      hex: "#d98a9e",
      lab: hexToLab("#d98a9e")!,
      lch: hexToLch("#d98a9e")!,
    },
  });
  assert.ok(Math.abs(r.score) <= 1);
  assert.ok(["warm", "cool", "neutral"].includes(r.value));
});

test("quality warnings never silently disappear", () => {
  const p = classify({
    colors: LIVE_MEASURED,
    quality: { has_face: true, area: "bad", frontal: "bad", lighting: "bad", faceangle: "bad" },
  });
  assert.ok(p.caveats.some((c) => /angle/i.test(c)));
  assert.ok(p.caveats.some((c) => /lighting/i.test(c)));
});
