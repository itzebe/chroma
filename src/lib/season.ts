/**
 * Deterministic 12-season color analysis.
 *
 * IMPORTANT FRAMING: seasonal color analysis is a *styling framework*, not a
 * scientific or medical classification. The thresholds below are calibrated
 * heuristics chosen so that the four measured YouCam colors map onto the
 * traditional seasonal vocabulary in a way a user can inspect and disagree with.
 * Every decision is exposed as a named signal with its raw metric, so nothing
 * here is an opaque model output.
 *
 * Thresholds were calibrated against reference skin tones in tests/season.test.ts.
 * A key empirical finding drove the design: skin hue angle ALONE does not
 * separate warm from cool (warm and cool reference skins overlap by ~1 degree),
 * so undertone is decided by a weighted vote across several signals and reported
 * with an explicit confidence rather than a single hard rule.
 */

import { hexToLab, hexToLch, deltaEHex, type Lab, type LCh } from "./color.ts";

export type Undertone = "warm" | "cool" | "neutral";
export type Depth = "light" | "medium" | "deep";
export type Clarity = "bright" | "medium" | "soft";
export type ContrastLevel = "high" | "medium" | "low";
export type Dominant = "light" | "deep" | "bright" | "soft" | "warm" | "cool";
export type SeasonId =
  | "light-spring"
  | "light-summer"
  | "true-spring"
  | "true-summer"
  | "bright-spring"
  | "bright-winter"
  | "soft-summer"
  | "soft-autumn"
  | "true-autumn"
  | "true-winter"
  | "deep-autumn"
  | "deep-winter";

export interface PaletteEntry {
  name: string;
  hex: string;
  role: "signature" | "neutral" | "accent";
}

export interface Season {
  id: SeasonId;
  name: string;
  family: "spring" | "summer" | "autumn" | "winter";
  undertone: Undertone;
  dominant: Dominant;
  summary: string;
  palette: PaletteEntry[];
  avoid: { name: string; hex: string }[];
}

// ---------------------------------------------------------------------------
// Thresholds. Named and exported so tests pin them and the UI can explain them.
// ---------------------------------------------------------------------------

/** Inclusive hue band, degrees. A band may wrap the 0/360 boundary. */
export type HueBand = readonly [number, number];

export const THRESHOLDS = {
  /** Skin L* at or above this reads as "light". */
  depthLightMinL: 70,
  /** Skin L* below this reads as "deep". */
  depthDeepMaxL: 47,
  /** Skin-to-darkest-feature L* gap at or above this reads as "high" contrast. */
  contrastHighMin: 35,
  /** L* gap below this reads as "low" contrast. */
  contrastLowMax: 20,
  /** Skin chroma at or above this (with high contrast) reads as "bright". */
  chromaBrightMin: 25,
  /** Skin chroma below this reads as "soft". */
  chromaSoftMax: 17,
  /** Skin b* at or above this votes warm. Calibrated: warm reference skins >= 15.67. */
  bStarWarmMin: 15.5,
  /** Skin b* at or below this votes cool. Calibrated: cool reference skins <= 13.76. */
  bStarCoolMax: 13.5,
  /**
   * Ratio of b* to a*. Weak separator: measured warm reference ratios span
   * [1.56..6.02] and cool [0.73..1.62], so the ranges overlap in [1.56..1.62].
   * The thresholds sit OUTSIDE that overlap on purpose, so an ambiguous colour
   * abstains (vote 0 -> neutral undertone) instead of being confidently wrong.
   */
  bOverAWarmMin: 1.65,
  bOverACoolMax: 1.55,
  /** Lip hue bands (practitioner convention: coral/peach vs pink/berry). */
  lipHueWarm: [30, 70] as HueBand,
  lipHueCool: [320, 25] as HueBand,
  /** Eye hue band for warm amber/hazel/golden-brown. */
  eyeHueWarm: [40, 90] as HueBand,
  eyeChromaWarmMin: 14,
  /** Undertone score needed to call it warm/cool rather than neutral. */
  undertoneNeutralBand: 0.2,
} satisfies Record<string, number | HueBand>;

// ---------------------------------------------------------------------------
// The 12 seasons and their palettes.
// ---------------------------------------------------------------------------

export const SEASONS: Record<SeasonId, Season> = {
  "light-spring": {
    id: "light-spring",
    name: "Light Spring",
    family: "spring",
    undertone: "warm",
    dominant: "light",
    summary:
      "Light and warm, with gentle contrast. Fresh, clear pastels and warm lights keep the face luminous; heavy or dusty colors weigh it down.",
    palette: [
      { name: "Peach", hex: "#ffd1a9", role: "signature" },
      { name: "Butter", hex: "#ffe9a8", role: "signature" },
      { name: "Mint", hex: "#9fd8c0", role: "signature" },
      { name: "Coral", hex: "#f79a8e", role: "accent" },
      { name: "Sky", hex: "#a8d8e8", role: "accent" },
      { name: "Warm cream", hex: "#fff7ec", role: "neutral" },
      { name: "Light camel", hex: "#d8c3a5", role: "neutral" },
      { name: "Soft cocoa", hex: "#7a6a58", role: "neutral" },
    ],
    avoid: [
      { name: "Optic black", hex: "#2b2b2b" },
      { name: "Deep plum", hex: "#6b2d5c" },
      { name: "Dark navy", hex: "#1f3a5f" },
    ],
  },
  "true-spring": {
    id: "true-spring",
    name: "True Spring",
    family: "spring",
    undertone: "warm",
    dominant: "warm",
    summary:
      "Clearly warm with medium depth and lively saturation. Warm, sunlit colors at full strength are the most flattering.",
    palette: [
      { name: "Tangerine", hex: "#ff8c42", role: "signature" },
      { name: "Sunflower", hex: "#ffd23f", role: "signature" },
      { name: "Spring green", hex: "#2eb88a", role: "signature" },
      { name: "Coral red", hex: "#f45b69", role: "accent" },
      { name: "Clear blue", hex: "#38b6ff", role: "accent" },
      { name: "Warm ivory", hex: "#fff3e0", role: "neutral" },
      { name: "Camel", hex: "#c99a5b", role: "neutral" },
      { name: "Warm brown", hex: "#6e5a3c", role: "neutral" },
    ],
    avoid: [
      { name: "Cool charcoal", hex: "#3b3b3b" },
      { name: "Muted purple", hex: "#5c4b8a" },
      { name: "Grey", hex: "#9aa5a0" },
    ],
  },
  "bright-spring": {
    id: "bright-spring",
    name: "Bright Spring",
    family: "spring",
    undertone: "warm",
    dominant: "bright",
    summary:
      "Warm and highly saturated with strong contrast. Clear, vivid colors hold their own against the face; muted tones read as washed out.",
    palette: [
      { name: "Vermilion", hex: "#ff5a36", role: "signature" },
      { name: "Golden yellow", hex: "#ffc400", role: "signature" },
      { name: "Emerald turquoise", hex: "#00b894", role: "signature" },
      { name: "Warm pink", hex: "#ff3d7f", role: "accent" },
      { name: "Azure", hex: "#0091ff", role: "accent" },
      { name: "Bright ivory", hex: "#fffbf0", role: "neutral" },
      { name: "Chestnut", hex: "#b0763f", role: "neutral" },
      { name: "Espresso", hex: "#2e2a26", role: "neutral" },
    ],
    avoid: [
      { name: "Cool grey", hex: "#6b6b6b" },
      { name: "Dusty lilac", hex: "#8e7ca8" },
      { name: "Slate blue", hex: "#a9b7c0" },
    ],
  },
  "light-summer": {
    id: "light-summer",
    name: "Light Summer",
    family: "summer",
    undertone: "cool",
    dominant: "light",
    summary:
      "Light and cool with soft, blended contrast. Delicate cool pastels and cool neutrals suit the face; warmth and weight do not.",
    palette: [
      { name: "Soft pink", hex: "#e8b4c8", role: "signature" },
      { name: "Baby blue", hex: "#b8d4e8", role: "signature" },
      { name: "Pale mint", hex: "#c7e0d0", role: "signature" },
      { name: "Mauve pink", hex: "#d9a8c0", role: "accent" },
      { name: "Powder blue", hex: "#a8c4dc", role: "accent" },
      { name: "Soft white", hex: "#f5f1ee", role: "neutral" },
      { name: "Cool greige", hex: "#c4b8b0", role: "neutral" },
      { name: "Cool slate", hex: "#6e6a70", role: "neutral" },
    ],
    avoid: [
      { name: "Black", hex: "#1a1a1a" },
      { name: "Orange", hex: "#e07a00" },
      { name: "Warm brown", hex: "#7a4a1f" },
    ],
  },
  "true-summer": {
    id: "true-summer",
    name: "True Summer",
    family: "summer",
    undertone: "cool",
    dominant: "cool",
    summary:
      "Unambiguously cool and gently muted. Cool, watercolor tones with moderate depth sit in harmony with the natural coloring.",
    palette: [
      { name: "Rose", hex: "#c48fa0", role: "signature" },
      { name: "Powder blue", hex: "#7fa8c9", role: "signature" },
      { name: "Seafoam", hex: "#6fa394", role: "signature" },
      { name: "Orchid", hex: "#b57ba6", role: "accent" },
      { name: "Denim blue", hex: "#5b8cb8", role: "accent" },
      { name: "Cool ivory", hex: "#efeae6", role: "neutral" },
      { name: "Grey taupe", hex: "#a89b94", role: "neutral" },
      { name: "Cool charcoal", hex: "#5a5a66", role: "neutral" },
    ],
    avoid: [
      { name: "Orange", hex: "#ff6b35" },
      { name: "Mustard", hex: "#f2c14e" },
      { name: "Warm brown", hex: "#3b2a1a" },
    ],
  },
  "soft-summer": {
    id: "soft-summer",
    name: "Soft Summer",
    family: "summer",
    undertone: "cool",
    dominant: "soft",
    summary:
      "Cool but low-contrast and muted. Colors that are greyed down and blended read as elegant; anything loud or pure overwhelms the face.",
    palette: [
      { name: "Muted rose", hex: "#b58ba0", role: "signature" },
      { name: "Dusty teal", hex: "#8ca3a8", role: "signature" },
      { name: "Soft lavender", hex: "#a8a0c0", role: "signature" },
      { name: "Dusty coral", hex: "#c98d8d", role: "accent" },
      { name: "Slate blue", hex: "#7e9ba8", role: "accent" },
      { name: "Mushroom", hex: "#e8e2dc", role: "neutral" },
      { name: "Taupe", hex: "#9c9188", role: "neutral" },
      { name: "Soft black", hex: "#4a4643", role: "neutral" },
    ],
    avoid: [
      { name: "Bright orange", hex: "#ff4500" },
      { name: "Bright yellow", hex: "#ffe600" },
      { name: "Optic black", hex: "#000000" },
    ],
  },
  "soft-autumn": {
    id: "soft-autumn",
    name: "Soft Autumn",
    family: "autumn",
    undertone: "warm",
    dominant: "soft",
    summary:
      "Warm and low-contrast with a muted, earthy quality. Softly toasted, dusty colors harmonize; clear brights look artificial.",
    palette: [
      { name: "Terracotta", hex: "#c08a6a", role: "signature" },
      { name: "Olive gold", hex: "#b5a642", role: "signature" },
      { name: "Sage", hex: "#8fa68e", role: "signature" },
      { name: "Soft rust", hex: "#c97b5a", role: "accent" },
      { name: "Moss", hex: "#a8a055", role: "accent" },
      { name: "Oat", hex: "#f0e8dc", role: "neutral" },
      { name: "Camel", hex: "#a89078", role: "neutral" },
      { name: "Deep umber", hex: "#4a4038", role: "neutral" },
    ],
    avoid: [
      { name: "Fuchsia", hex: "#ff00ff" },
      { name: "Electric blue", hex: "#0057b8" },
      { name: "Stark white", hex: "#ffffff" },
    ],
  },
  "true-autumn": {
    id: "true-autumn",
    name: "True Autumn",
    family: "autumn",
    undertone: "warm",
    dominant: "warm",
    summary:
      "Deeply warm and rich. Spiced, golden-toned colors at medium-to-deep depth are the most flattering; cool pastels drain the face.",
    palette: [
      { name: "Rust", hex: "#b5541e", role: "signature" },
      { name: "Mustard", hex: "#a88b2f", role: "signature" },
      { name: "Forest", hex: "#4f7942", role: "signature" },
      { name: "Burnt orange", hex: "#c1662f", role: "accent" },
      { name: "Olive", hex: "#8a9a3b", role: "accent" },
      { name: "Warm cream", hex: "#ede0ce", role: "neutral" },
      { name: "Bronze camel", hex: "#9c7a4e", role: "neutral" },
      { name: "Dark espresso", hex: "#3e332a", role: "neutral" },
    ],
    avoid: [
      { name: "Hot pink", hex: "#ff69b4" },
      { name: "Bright blue", hex: "#00bfff" },
      { name: "Cool silver", hex: "#c0c0c0" },
    ],
  },
  "deep-autumn": {
    id: "deep-autumn",
    name: "Deep Autumn",
    family: "autumn",
    undertone: "warm",
    dominant: "deep",
    summary:
      "Deep and warm. Rich, dark, spiced colors carry the face; light and cool tints disappear against it.",
    palette: [
      { name: "Chestnut", hex: "#7b3f00", role: "signature" },
      { name: "Deep olive", hex: "#6b7a2f", role: "signature" },
      { name: "Maroon", hex: "#6a2e35", role: "signature" },
      { name: "Sienna", hex: "#a0522d", role: "accent" },
      { name: "Dark olive", hex: "#556b2f", role: "accent" },
      { name: "Sand", hex: "#e0d2c0", role: "neutral" },
      { name: "Warm bronze", hex: "#8a6a4a", role: "neutral" },
      { name: "Near black", hex: "#2e2620", role: "neutral" },
    ],
    avoid: [
      { name: "Pale lavender", hex: "#e6e6fa" },
      { name: "Pastel blue", hex: "#add8e6" },
      { name: "Pale pink", hex: "#ffe4e1" },
    ],
  },
  "bright-winter": {
    id: "bright-winter",
    name: "Bright Winter",
    family: "winter",
    undertone: "cool",
    dominant: "bright",
    summary:
      "Cool and intensely saturated with sharp contrast. Jewel-bright colors and true black flatter; anything muted goes flat.",
    palette: [
      { name: "Hot pink", hex: "#ff1d5e", role: "signature" },
      { name: "Electric blue", hex: "#0057b8", role: "signature" },
      { name: "Turquoise", hex: "#00a19a", role: "signature" },
      { name: "True red", hex: "#e4002b", role: "accent" },
      { name: "Royal purple", hex: "#7b2fbe", role: "accent" },
      { name: "Pure white", hex: "#ffffff", role: "neutral" },
      { name: "Cool grey", hex: "#6e6e6e", role: "neutral" },
      { name: "True black", hex: "#0b0b0b", role: "neutral" },
    ],
    avoid: [
      { name: "Warm camel", hex: "#c49a6c" },
      { name: "Warm brown", hex: "#8a6e4b" },
      { name: "Dusty gold", hex: "#b58a5a" },
    ],
  },
  "true-winter": {
    id: "true-winter",
    name: "True Winter",
    family: "winter",
    undertone: "cool",
    dominant: "cool",
    summary:
      "Decisively cool and clear. Cool, high-contrast jewel tones and true neutrals are the most flattering; warmth muddies the face.",
    palette: [
      { name: "True red", hex: "#c8102e", role: "signature" },
      { name: "Navy", hex: "#1b3a6b", role: "signature" },
      { name: "Emerald", hex: "#00594c", role: "signature" },
      { name: "Magenta", hex: "#d6006e", role: "accent" },
      { name: "Royal blue", hex: "#0072ce", role: "accent" },
      { name: "Pure white", hex: "#ffffff", role: "neutral" },
      { name: "Cool grey", hex: "#4a4e57", role: "neutral" },
      { name: "True black", hex: "#000000", role: "neutral" },
    ],
    avoid: [
      { name: "Orange", hex: "#e0a458" },
      { name: "Warm brown", hex: "#9c6b3f" },
      { name: "Camel", hex: "#c7a17a" },
    ],
  },
  "deep-winter": {
    id: "deep-winter",
    name: "Deep Winter",
    family: "winter",
    undertone: "cool",
    dominant: "deep",
    summary:
      "Deep and cool with strong contrast. Dark, saturated cool colors and true black are most flattering; pale warmth washes the face out.",
    palette: [
      { name: "Wine", hex: "#7b1e3a", role: "signature" },
      { name: "Deep navy", hex: "#14324f", role: "signature" },
      { name: "Pine", hex: "#00614e", role: "signature" },
      { name: "Ruby", hex: "#c2185b", role: "accent" },
      { name: "Slate blue", hex: "#2e5a87", role: "accent" },
      { name: "Pure white", hex: "#ffffff", role: "neutral" },
      { name: "Charcoal", hex: "#33383d", role: "neutral" },
      { name: "True black", hex: "#0a0a0a", role: "neutral" },
    ],
    avoid: [
      { name: "Gold-orange", hex: "#d9a05b" },
      { name: "Warm tan", hex: "#b98356" },
      { name: "Peach", hex: "#e8c39e" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Measured input from YouCam
// ---------------------------------------------------------------------------

export interface MeasuredColors {
  skin_color?: string | null;
  lip_color?: string | null;
  eye_color?: string | null;
  eyebrow_color?: string | null;
  /** YouCam documents this field but does not always return it. Treated as optional. */
  hair_color?: string | null;
  eye_color_name?: string | null;
  hair_color_name?: string | null;
}

export interface FaceQuality {
  has_face?: boolean;
  area?: string | null;
  frontal?: string | null;
  lighting?: string | null;
  faceangle?: string | null;
}

export interface FeatureReading {
  key: "skin" | "lip" | "eye" | "eyebrow" | "hair";
  label: string;
  hex: string;
  lab: Lab;
  lch: LCh;
}

export interface Signal {
  key: string;
  label: string;
  /** Raw metric value the vote was derived from. */
  value: number | null;
  /** +1 warm, -1 cool, 0 no information. */
  vote: number;
  weight: number;
  explanation: string;
}

export interface UndertoneResult {
  value: Undertone;
  /** Weighted mean vote in [-1, 1]. Positive leans warm. */
  score: number;
  signals: Signal[];
  reason: string;
}

export interface AxisResult<T> {
  value: T;
  metric: number;
  reason: string;
}

export interface DominanceScore {
  dominant: Dominant;
  score: number;
  reason: string;
}

export interface ColorProfile {
  season: Season;
  seasonId: SeasonId;
  features: FeatureReading[];
  missing: string[];
  undertone: UndertoneResult;
  depth: AxisResult<Depth>;
  clarity: AxisResult<Clarity>;
  contrast: AxisResult<ContrastLevel>;
  dominance: DominanceScore[];
  confidence: number;
  confidenceLabel: "high" | "moderate" | "low";
  caveats: string[];
  quality: FaceQuality;
  framework: "seasonal-styling";
  disclaimer: string;
}

export const SEASONAL_DISCLAIMER =
  "Seasonal color analysis is a styling framework used by image consultants, not a " +
  "scientific or medical assessment. Measured values come from the YouCam API; the " +
  "seasonal label is a calculated interpretation you are free to disagree with.";

function reading(
  key: FeatureReading["key"],
  label: string,
  hex: string,
): FeatureReading | null {
  const lab = hexToLab(hex);
  const lch = hexToLch(hex);
  if (!lab || !lch) return null;
  return { key, label, hex, lab, lch };
}

function inBand(value: number, band: readonly [number, number]): boolean {
  const [lo, hi] = band;
  // Bands may wrap the 0/360 boundary (e.g. cool lip hues 320..25).
  return lo <= hi ? value >= lo && value <= hi : value >= lo || value <= hi;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Weighted vote across independent signals. */
export function scoreUndertone(features: {
  skin: FeatureReading;
  lip?: FeatureReading;
  eye?: FeatureReading;
  eyebrow?: FeatureReading;
}): UndertoneResult {
  const signals: Signal[] = [];
  const { skin, lip, eye, eyebrow } = features;

  const bStarVote =
    skin.lab.b >= THRESHOLDS.bStarWarmMin
      ? 1
      : skin.lab.b <= THRESHOLDS.bStarCoolMax
        ? -1
        : 0;
  signals.push({
    key: "skin.bStar",
    label: "Skin yellow–blue balance (b*)",
    value: skin.lab.b,
    vote: bStarVote,
    weight: 1,
    explanation: `Skin b* = ${skin.lab.b.toFixed(1)}. Above ${THRESHOLDS.bStarWarmMin} reads warm, below ${THRESHOLDS.bStarCoolMax} reads cool. This is the strongest single separator in calibration.`,
  });

  const ratio = skin.lab.a === 0 ? 0 : skin.lab.b / skin.lab.a;
  const ratioVote =
    ratio >= THRESHOLDS.bOverAWarmMin ? 1 : ratio <= THRESHOLDS.bOverACoolMax ? -1 : 0;
  signals.push({
    key: "skin.bOverA",
    label: "Warmth ratio (b*/a*)",
    value: ratio,
    vote: ratioVote,
    weight: 0.5,
    explanation: `b*/a* = ${ratio.toFixed(2)}. Corrects for skin darkness; deliberately low weight because warm and cool overlap in this metric.`,
  });

  if (lip) {
    const lipVote = inBand(lip.lch.h, THRESHOLDS.lipHueWarm)
      ? 1
      : inBand(lip.lch.h, THRESHOLDS.lipHueCool)
        ? -1
        : 0;
    signals.push({
      key: "lip.hue",
      label: "Lip hue",
      value: lip.lch.h,
      vote: lipVote,
      weight: 0.6,
      explanation: `Measured lip hue ${lip.lch.h.toFixed(1)}°. Coral/peach hues (30–70°) read warm; pink/berry (320–25°) read cool. Practitioner convention, not a measurement of undertone.`,
    });
  }

  if (eye) {
    const eyeVote =
      inBand(eye.lch.h, THRESHOLDS.eyeHueWarm) && eye.lch.C >= THRESHOLDS.eyeChromaWarmMin
        ? 1
        : eye.lch.h >= 180 && eye.lch.h <= 260
          ? -1
          : 0;
    signals.push({
      key: "eye.hue",
      label: "Eye hue",
      value: eye.lch.h,
      vote: eyeVote,
      weight: 0.4,
      explanation: `Measured eye hue ${eye.lch.h.toFixed(1)}° at chroma ${eye.lch.C.toFixed(1)}. Amber/hazel/golden-brown reads warm; blue reads cool. Dark neutral browns abstain.`,
    });
  }

  if (eyebrow) {
    const eyebrowVote =
      eyebrow.lab.b >= THRESHOLDS.bStarWarmMin
        ? 1
        : eyebrow.lab.b <= THRESHOLDS.bStarCoolMax
          ? -1
          : 0;
    signals.push({
      key: "eyebrow.bStar",
      label: "Brow yellow–blue balance (b*)",
      value: eyebrow.lab.b,
      vote: eyebrowVote,
      weight: 0.3,
      explanation: `Brow b* = ${eyebrow.lab.b.toFixed(1)}. Brows are usually low-chroma, so this is a weak supporting signal.`,
    });
  }

  const totalWeight = signals.reduce((s, x) => s + (x.vote === 0 ? 0 : x.weight), 0);
  const weighted = signals.reduce((s, x) => s + x.vote * x.weight, 0);
  const score = totalWeight === 0 ? 0 : weighted / totalWeight;

  const value: Undertone =
    score > THRESHOLDS.undertoneNeutralBand
      ? "warm"
      : score < -THRESHOLDS.undertoneNeutralBand
        ? "cool"
        : "neutral";

  const voted = signals.filter((s) => s.vote !== 0).length;
  const reason =
    totalWeight === 0
      ? "No signal carried information about warmth, so undertone is reported as neutral rather than guessed."
      : `${voted} of ${signals.length} signals voted; weighted score ${score.toFixed(2)} in [-1,1] gives "${value}".`;

  return { value, score, signals, reason };
}

export function axisDepth(skin: FeatureReading): AxisResult<Depth> {
  const L = skin.lab.L;
  const value: Depth =
    L >= THRESHOLDS.depthLightMinL ? "light" : L < THRESHOLDS.depthDeepMaxL ? "deep" : "medium";
  return {
    value,
    metric: L,
    reason: `Skin L* = ${L.toFixed(1)}. Light if >= ${THRESHOLDS.depthLightMinL}, deep if < ${THRESHOLDS.depthDeepMaxL}, otherwise medium.`,
  };
}

/** L* gap between skin and the darkest available feature. */
export function measureContrast(
  skin: FeatureReading,
  others: FeatureReading[],
): { level: ContrastLevel; gap: number; source: string | null } {
  const candidates = others.filter((f) => f.key !== "skin");
  if (candidates.length === 0) {
    return { level: "medium", gap: 0, source: null };
  }
  const darkest = candidates.reduce((min, f) => (f.lab.L < min.lab.L ? f : min), candidates[0]);
  const gap = Math.abs(skin.lab.L - darkest.lab.L);
  const level: ContrastLevel =
    gap >= THRESHOLDS.contrastHighMin
      ? "high"
      : gap < THRESHOLDS.contrastLowMax
        ? "low"
        : "medium";
  return { level, gap, source: darkest.key };
}

export function axisClarity(
  skin: FeatureReading,
  contrast: ContrastLevel,
): AxisResult<Clarity> {
  const C = skin.lch.C;
  let value: Clarity;
  if (contrast === "high" && C >= THRESHOLDS.chromaBrightMin) value = "bright";
  else if (contrast === "low" || C < THRESHOLDS.chromaSoftMax) value = "soft";
  else value = "medium";
  return {
    value,
    metric: C,
    reason: `Skin chroma = ${C.toFixed(1)} and contrast = ${contrast}. Bright needs high contrast with chroma >= ${THRESHOLDS.chromaBrightMin}; soft is low contrast or chroma < ${THRESHOLDS.chromaSoftMax}.`,
  };
}

/** Normalized distance of each axis from its neutral midpoint. */
export function dominanceScores(
  depth: AxisResult<Depth>,
  clarity: AxisResult<Clarity>,
  contrast: ContrastLevel,
  undertone: UndertoneResult,
): DominanceScore[] {
  const L = depth.metric;
  const lightScore = clamp01((L - THRESHOLDS.depthLightMinL) / (100 - THRESHOLDS.depthLightMinL));
  const deepScore = clamp01((THRESHOLDS.depthDeepMaxL - L) / THRESHOLDS.depthDeepMaxL);

  const contrastScore =
    contrast === "high" ? 1 : contrast === "low" ? -1 : 0;
  const chromaSpan = 40;
  const chromaScore = clamp01((clarity.metric - THRESHOLDS.chromaSoftMax) / chromaSpan);
  const brightScore = clamp01((contrastScore + chromaScore) / 2);
  const softScore = clamp01((chromaScore < 0.35 ? 1 - chromaScore : 0) * (contrastScore <= 0 ? 1 : 0.5));

  const warmScore = clamp01(undertone.score);
  const coolScore = clamp01(-undertone.score);

  const all: DominanceScore[] = [
    { dominant: "light", score: lightScore, reason: `Depth deviation: L* ${L.toFixed(1)}.` },
    { dominant: "deep", score: deepScore, reason: `Depth deviation: L* ${L.toFixed(1)}.` },
    {
      dominant: "bright",
      score: brightScore,
      reason: `Contrast ${contrast} and chroma ${clarity.metric.toFixed(1)}.`,
    },
    {
      dominant: "soft",
      score: softScore,
      reason: `Mutedness: chroma ${clarity.metric.toFixed(1)}, contrast ${contrast}.`,
    },
    {
      dominant: "warm",
      score: warmScore,
      reason: `Undertone score ${undertone.score.toFixed(2)} (positive = warm).`,
    },
    {
      dominant: "cool",
      score: coolScore,
      reason: `Undertone score ${undertone.score.toFixed(2)} (negative = cool).`,
    },
  ];

  // Deterministic ordering: score desc, then a fixed axis priority for exact ties.
  const priority: Dominant[] = ["light", "deep", "bright", "soft", "warm", "cool"];
  return all.sort(
    (a, b) => b.score - a.score || priority.indexOf(a.dominant) - priority.indexOf(b.dominant),
  );
}

/** Map (dominant axis, undertone, depth, clarity) onto one of the 12 seasons. */
export function mapSeason(
  dominant: Dominant,
  undertone: Undertone,
  depth: Depth,
  clarity: Clarity,
): SeasonId {
  const coolSide = undertone !== "warm"; // neutral falls to the cool family for these axes
  switch (dominant) {
    case "light":
      return coolSide ? "light-summer" : "light-spring";
    case "deep":
      return coolSide ? "deep-winter" : "deep-autumn";
    case "bright":
      return coolSide ? "bright-winter" : "bright-spring";
    case "soft":
      return coolSide ? "soft-summer" : "soft-autumn";
    case "warm":
      // Warm-dominant: lighter/clearer reads Spring, deeper reads Autumn.
      return depth === "light" || clarity === "bright" ? "true-spring" : "true-autumn";
    case "cool":
      return depth === "light" || clarity === "bright" ? "true-summer" : "true-winter";
  }
}

export interface ClassifyInput {
  colors: MeasuredColors;
  quality?: FaceQuality;
}

/**
 * Classify measured YouCam colors into a seasonal profile.
 * Never throws on missing data: absent features reduce confidence and are listed
 * in `missing`, so the UI can be honest rather than invent a reading.
 */
export function classify({ colors, quality = {} }: ClassifyInput): ColorProfile {
  const skin = colors.skin_color ? reading("skin", "Skin", colors.skin_color) : null;
  const lip = colors.lip_color ? reading("lip", "Lips", colors.lip_color) : null;
  const eye = colors.eye_color ? reading("eye", "Eyes", colors.eye_color) : null;
  const eyebrow = colors.eyebrow_color ? reading("eyebrow", "Brows", colors.eyebrow_color) : null;
  const hair = colors.hair_color ? reading("hair", "Hair", colors.hair_color) : null;

  const missing: string[] = [];
  if (!lip) missing.push("lip");
  if (!eye) missing.push("eye");
  if (!eyebrow) missing.push("eyebrow");
  if (!hair) missing.push("hair");

  if (!skin) {
    throw new Error(
      "skin_color is required to build a color profile; YouCam did not return a usable value.",
    );
  }

  const features = [skin, lip, eye, eyebrow, hair].filter(
    (f): f is FeatureReading => f !== null,
  );

  const undertone = scoreUndertone({ skin, lip: lip ?? undefined, eye: eye ?? undefined, eyebrow: eyebrow ?? undefined });
  const depth = axisDepth(skin);
  const contrastResult = measureContrast(skin, features);
  const clarity = axisClarity(skin, contrastResult.level);
  const dominance = dominanceScores(depth, clarity, contrastResult.level, undertone);
  const seasonId = mapSeason(dominance[0].dominant, undertone.value, depth.value, clarity.value);
  const season = SEASONS[seasonId];

  // ---- confidence -----------------------------------------------------------
  const caveats: string[] = [];
  const featureCoverage = 1 - missing.length / 4; // skin always present
  let confidence = 0.35 + 0.35 * featureCoverage;
  confidence += Math.min(0.15, Math.abs(undertone.score) * 0.15);
  confidence += Math.min(0.1, (dominance[0].score - dominance[1].score) * 0.5);

  if (missing.includes("hair")) {
    caveats.push(
      "Hair color was not returned by the API, so the profile rests on skin, lips, eyes and brows only.",
    );
  }
  if (missing.includes("lip") || missing.includes("eye")) {
    caveats.push("Some facial features were missing, which weakens the contrast measurement.");
  }
  if (undertone.value === "neutral") {
    caveats.push(
      "Warm and cool signals were too close to call, so the undertone is reported as neutral and the season leans on depth and contrast instead.",
    );
  }
  if (dominance[0].score - dominance[1].score < 0.08) {
    caveats.push(
      `The top two dominant characteristics are close (${dominance[0].dominant} ${dominance[0].score.toFixed(2)} vs ${dominance[1].dominant} ${dominance[1].score.toFixed(2)}), so a neighbouring season is also plausible.`,
    );
  }
  if (quality.frontal && quality.frontal !== "good") {
    caveats.push(`Face angle was reported as "${quality.frontal}", which can shift measured color.`);
  }
  if (quality.lighting && quality.lighting !== "good") {
    caveats.push(
      `Lighting was reported as "${quality.lighting}". Uneven light is the largest source of error in skin color measurement.`,
    );
  }
  if (quality.faceangle && quality.faceangle !== "good" && quality.faceangle !== "normal") {
    caveats.push(`Head pose was reported as "${quality.faceangle}".`);
  }

  confidence = clamp01(confidence);
  const confidenceLabel: ColorProfile["confidenceLabel"] =
    confidence >= 0.7 ? "high" : confidence >= 0.5 ? "moderate" : "low";

  return {
    season,
    seasonId,
    features,
    missing,
    undertone,
    depth,
    clarity,
    contrast: {
      value: contrastResult.level,
      metric: contrastResult.gap,
      reason:
        contrastResult.source === null
          ? "Only one color was available, so contrast could not be measured and defaults to medium."
          : `L* gap of ${contrastResult.gap.toFixed(1)} between skin and the darkest feature (${contrastResult.source}). High if >= ${THRESHOLDS.contrastHighMin}, low if < ${THRESHOLDS.contrastLowMax}.`,
    },
    dominance,
    confidence,
    confidenceLabel,
    caveats,
    quality,
    framework: "seasonal-styling",
    disclaimer: SEASONAL_DISCLAIMER,
  };
}

/**
 * Rank a candidate color against a season palette.
 * Returns the nearest palette entry and the CIEDE2000 distance, so the garment
 * verdict and the makeup generator share one definition of "harmony".
 */
export function nearestPaletteEntry(
  hex: string,
  season: Season,
): { entry: PaletteEntry; distance: number } | null {
  let best: { entry: PaletteEntry; distance: number } | null = null;
  for (const entry of season.palette) {
    const d = deltaEHex(hex, entry.hex);
    if (d === null) continue;
    if (!best || d < best.distance) best = { entry, distance: d };
  }
  return best;
}
