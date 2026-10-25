/**
 * Garment colour harmony.
 *
 * Answers the question a shopper actually has in front of a product page: will
 * this colour work on me? The verdict is computed from the measured season
 * palette using CIEDE2000, and it is deliberately four-valued rather than a
 * binary yes/no, because "challenging" is a real and useful answer.
 *
 * Note on naming: no third-party brand names or trademarked shade names are used
 * anywhere in this app. Product shades in `products.ts` are a generic library
 * used to demonstrate shade matching.
 */

import { deltaE2000, deltaEHex, hexToLab, hexToLch, labToHex } from "./color.ts";
import type { ColorProfile, PaletteEntry, Season } from "./season.ts";

export type GarmentVerdict = "excellent" | "good" | "workable" | "challenging";

export interface GarmentAdvice {
  hex: string;
  verdict: GarmentVerdict;
  /** CIEDE2000 distance to the nearest palette colour. */
  distance: number;
  nearest: PaletteEntry;
  /** The palette colour to pair it with when the verdict is not excellent. */
  pairing: PaletteEntry | null;
  headline: string;
  detail: string;
  /** Concrete styling instruction. */
  advice: string;
}

/**
 * Thresholds on CIEDE2000 distance to the nearest palette colour.
 * CIEDE2000 is roughly perceptually uniform: ~1 is a just-noticeable difference,
 * ~5 is clearly different, ~15+ is a different colour family entirely.
 */
export const GARMENT_THRESHOLDS = {
  excellent: 6,
  good: 14,
  workable: 24,
} as const;

function verdictFor(distance: number): GarmentVerdict {
  if (distance <= GARMENT_THRESHOLDS.excellent) return "excellent";
  if (distance <= GARMENT_THRESHOLDS.good) return "good";
  if (distance <= GARMENT_THRESHOLDS.workable) return "workable";
  return "challenging";
}

/** Nearest entry by CIEDE2000, with the entry itself returned. */
function nearest<T extends { name: string; hex: string }>(
  hex: string,
  entries: T[],
): { entry: T; distance: number } | null {
  let best: { entry: T; distance: number } | null = null;
  for (const entry of entries) {
    const d = deltaEHex(hex, entry.hex);
    if (d === null) continue;
    if (!best || d < best.distance) best = { entry, distance: d };
  }
  return best;
}

/**
 * Judge a garment colour against a person's season.
 *
 * The `avoid` list is treated as a soft signal rather than a veto: a colour close
 * to an "avoid" swatch but also close to a palette colour is reported honestly as
 * workable, with a pairing suggestion, instead of being rejected outright.
 */
export function evaluateGarment(hex: string, profile: ColorProfile): GarmentAdvice | null {
  const lab = hexToLab(hex);
  if (!lab) return null;

  const season: Season = profile.season;
  const nearPalette = nearest(hex, season.palette);
  if (!nearPalette) return null;

  const nearAvoid = nearest(hex, season.avoid);
  const distance = nearPalette.distance;
  const baseVerdict = verdictFor(distance);

  // If it is closer to an avoid colour than to any palette colour, soften the
  // verdict by one step - never further, so a genuinely great colour is not
  // punished for a coincidental avoid match.
  const order: GarmentVerdict[] = ["excellent", "good", "workable", "challenging"];
  let verdict = baseVerdict;
  if (nearAvoid && nearAvoid.distance < distance) {
    verdict = order[Math.min(order.indexOf(baseVerdict) + 1, order.length - 1)];
  }

  const lch = hexToLch(hex)!;
  const pale = lch.L > 88;
  const veryDark = lch.L < 18;

  let pairing: PaletteEntry | null = null;
  if (verdict !== "excellent") {
    const accents = season.palette.filter((p) => p.role === "accent");
    const neutrals = season.palette.filter((p) => p.role === "neutral");
    const pool = verdict === "challenging" ? neutrals : accents;
    pairing = (pool.length ? pool : season.palette).reduce((a, b) =>
      Math.abs(hexToLab(b.hex)!.L - lch.L) < Math.abs(hexToLab(a.hex)!.L - lch.L) ? b : a,
    );
  }

  const headline =
    verdict === "excellent"
      ? `${season.name}: this colour is on your palette`
      : verdict === "good"
        ? `${season.name}: a very easy colour for you`
        : verdict === "workable"
          ? `${season.name}: workable with the right pairing`
          : `${season.name}: outside your palette`;

  const detail =
    `Measured ${hex} sits ${distance.toFixed(1)} away from your closest palette colour, ` +
    `"${nearPalette.entry.name}" (${nearPalette.entry.hex}), on the CIEDE2000 scale. ` +
    (nearAvoid
      ? `It is ${nearAvoid.distance.toFixed(1)} from your closest colour to avoid, "${nearAvoid.entry.name}".`
      : "");

  const advice = (() => {
    if (verdict === "excellent") {
      return `Wear it near your face. It shares the lightness and warmth of your palette, so it will not fight your skin.`;
    }
    if (verdict === "good") {
      return pairing
        ? `Good as-is. If you want it to sit even better, pair it with ${pairing.name} (${pairing.hex}).`
        : "Good as-is.";
    }
    if (verdict === "challenging") {
      return (
        `Keep it away from your face: wear it as trousers, a skirt or a bag, and put ${pairing?.name ?? "a palette neutral"} ` +
        `(${pairing?.hex ?? season.palette[0].hex}) next to your face instead.`
      );
    }
    return (
      `Wear it, but break it up: add ${pairing?.name ?? "a palette accent"} (${pairing?.hex ?? season.palette[0].hex}) ` +
      `at the neckline or as a scarf so the transition is not one flat block.`
    );
  })();

  const notes: string[] = [];
  if (pale) notes.push("It is very light, so it will read as low contrast against most skin tones.");
  if (veryDark) notes.push("It is very dark, which raises contrast sharply.");

  const adviceWithNotes =
    notes.length && verdict !== "excellent" ? `${advice} ${notes.join(" ")}` : advice;

  return {
    hex,
    verdict,
    distance,
    nearest: nearPalette.entry,
    pairing,
    headline,
    detail,
    advice: adviceWithNotes,
  };
}

export interface GarmentPairingSuggestion {
  /** Colours from the season palette that harmonise with the chosen garment. */
  pairs: PaletteEntry[];
  reason: string;
}

/**
 * Suggest palette colours that pair with a garment, using the same perceptual
 * distance so the advice is consistent with the verdict above.
 */
export function suggestPairings(hex: string, profile: ColorProfile, limit = 3): GarmentPairingSuggestion {
  const lab = hexToLab(hex);
  if (!lab) return { pairs: [], reason: "Colour could not be read." };

  const scored = profile.season.palette
    .map((entry) => {
      const other = hexToLab(entry.hex)!;
      const dL = Math.abs(lab.L - other.L);
      const d = deltaE2000(lab, other);
      // Prefer a clear contrast step: too close and it reads as a mismatched set.
      const contrastScore = dL < 12 ? -1 : Math.min(dL, 45);
      return { entry, contrastScore, d };
    })
    .sort((a, b) => b.contrastScore - a.contrastScore || a.d - b.d);

  return {
    pairs: scored.slice(0, limit).map((s) => s.entry),
    reason:
      "Chosen from your palette for a visible lightness step (about 12 L* or more), so the two colours read as a deliberate pairing rather than a near-miss.",
  };
}

/**
 * Suggest an in-season adjustment to a garment colour, for when the user owns the
 * item and cannot change it. Returns an alternative they could buy instead.
 */
export function suggestAlternative(hex: string, profile: ColorProfile): PaletteEntry {
  const near = nearest(hex, profile.season.palette);
  if (near && near.distance <= GARMENT_THRESHOLDS.excellent) return near.entry;

  const lch = hexToLch(hex)!;
  // Pick the palette entry with the closest lightness, so the swap keeps the
  // garment's overall depth even when the hue changes.
  return profile.season.palette.reduce((a, b) => {
    const dA = Math.abs(hexToLab(a.hex)!.L - lch.L);
    const dB = Math.abs(hexToLab(b.hex)!.L - lch.L);
    return dB < dA ? b : a;
  });
}

/**
 * Build a "wear this instead" swatch that is a small, believable step from a
 * challenging colour toward the palette, rather than a jump to a different hue.
 */
export function nudgeTowardSeason(hex: string, profile: ColorProfile, steps = 3): string[] {
  const target = suggestAlternative(hex, profile);
  const from = hexToLab(hex);
  const to = hexToLab(target.hex);
  if (!from || !to) return [];

  const out: string[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    out.push(
      labToHex({
        L: from.L + (to.L - from.L) * t,
        a: from.a + (to.a - from.a) * t,
        b: from.b + (to.b - from.b) * t,
      }),
    );
  }
  return out;
}
