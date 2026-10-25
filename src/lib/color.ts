/**
 * Color-science primitives for the seasonal engine.
 *
 * Pure functions, no dependencies, no side effects - safe to import from both
 * server and client. Conversions follow the published CIE / sRGB definitions so
 * that every threshold in the seasonal model can be tested against known values.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** CIE L*a*b* (D65). L in [0,100]. */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** Cylindrical form of Lab: lightness, chroma, hue angle in degrees [0,360). */
export interface LCh {
  L: number;
  C: number;
  h: number;
}

/** sRGB D65 white point. */
const WHITE = { X: 0.95047, Y: 1.0, Z: 1.08883 };
const DELTA = 6 / 29;

export function isValidHex(value: unknown): value is string {
  return typeof value === "string" && /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

/** Parse `#rgb` / `#rrggbb` (hash optional). Returns null on anything malformed. */
export function parseHex(hex: string): RGB | null {
  if (!isValidHex(hex)) return null;
  const body = hex.trim().replace(/^#/, "");
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: RGB): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Normalize any accepted hex form to lowercase `#rrggbb`, or null if invalid. */
export function normalizeHex(hex: string): string | null {
  const rgb = parseHex(hex);
  return rgb ? toHex(rgb) : null;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return c * 255;
}

function f(t: number): number {
  return t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA ** 2) + 4 / 29;
}

function fInv(t: number): number {
  return t > DELTA ? t ** 3 : 3 * DELTA ** 2 * (t - 4 / 29);
}

export function rgbToLab(rgb: RGB): Lab {
  const R = srgbToLinear(rgb.r);
  const G = srgbToLinear(rgb.g);
  const B = srgbToLinear(rgb.b);

  const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = 0.0193339 * R + 0.119192 * G + 0.9503041 * B;

  const fx = f(X / WHITE.X);
  const fy = f(Y / WHITE.Y);
  const fz = f(Z / WHITE.Z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * Convert Lab back to sRGB.
 *
 * Channels are clamped to [0,255]: a Lab value outside the sRGB gamut would
 * otherwise yield out-of-range channels that silently corrupt any later
 * arithmetic (and `toHex` would hide the problem by rounding). Every caller here
 * converts for display, so clamping at the boundary is the safe default.
 */
export function labToRgb(lab: Lab): RGB {
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;

  const X = WHITE.X * fInv(fx);
  const Y = WHITE.Y * fInv(fy);
  const Z = WHITE.Z * fInv(fz);

  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;

  const clamp = (v: number) => Math.max(0, Math.min(255, linearToSrgb(v)));
  return { r: clamp(R), g: clamp(G), b: clamp(B) };
}

export function hexToLab(hex: string): Lab | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToLab(rgb) : null;
}

/**
 * True when a Lab colour survives the sRGB round-trip unchanged, i.e. it is inside
 * the sRGB gamut and will not be clamped.
 *
 * This matters for generated colours: asking for a saturated hue at a low L* can
 * fall outside sRGB, and the clamp that follows silently moves the colour's
 * lightness - the depth a makeup look depends on. Callers that care about depth
 * should check this and reduce chroma rather than accept the drift.
 */
export function isInSrgbGamut(lab: Lab): boolean {
  const back = rgbToLab(labToRgb(lab));
  return (
    Math.abs(back.L - lab.L) < 0.5 &&
    Math.abs(back.a - lab.a) < 1.5 &&
    Math.abs(back.b - lab.b) < 1.5
  );
}

/**
 * Set a colour's lightness to `targetL` while keeping its hue and reducing chroma
 * only as far as necessary to stay inside sRGB.
 *
 * Returns the achieved Lab and its hex. When the requested depth is unreachable at
 * the original chroma, chroma is scaled down in steps and the result is verified
 * against `isInSrgbGamut`, so the returned L* is the real one rather than the
 * requested one.
 */
export function withLightness(lab: Lab, targetL: number): { hex: string; lab: Lab } {
  const lch = labToLch(lab);
  const hue = lch?.h ?? 0;
  const maxChroma = lch?.C ?? 0;
  const L = Math.max(0, Math.min(100, targetL));

  // Try progressively lower chroma until the colour is representable in sRGB.
  for (let c = maxChroma; c >= 0; c -= Math.max(1, maxChroma / 24)) {
    const candidate = { L, a: c * Math.cos((hue * Math.PI) / 180), b: c * Math.sin((hue * Math.PI) / 180) };
    if (isInSrgbGamut(candidate)) {
      return { hex: labToHex(candidate), lab: rgbToLab(labToRgb(candidate)) };
    }
  }
  const grey = { L, a: 0, b: 0 };
  return { hex: labToHex(grey), lab: rgbToLab(labToRgb(grey)) };
}

export function labToHex(lab: Lab): string {
  return toHex(labToRgb(lab));
}

/**
 * Chroma below this is treated as achromatic. sRGB grey does not map to exactly
 * a=b=0 in Lab (matrix rounding leaves ~1e-5), so the threshold must sit above
 * that noise floor or a neutral reports a meaningless hue angle.
 */
export const NEUTRAL_CHROMA_EPSILON = 1e-3;

export function labToLch(lab: Lab): LCh {
  const C = Math.hypot(lab.a, lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L: lab.L, C, h: C < NEUTRAL_CHROMA_EPSILON ? 0 : h };
}

export function lchToLab(lch: LCh): Lab {
  const rad = (lch.h * Math.PI) / 180;
  return { L: lch.L, a: lch.C * Math.cos(rad), b: lch.C * Math.sin(rad) };
}

export function hexToLch(hex: string): LCh | null {
  const lab = hexToLab(hex);
  return lab ? labToLch(lab) : null;
}

/** Smallest signed angular distance between two hues, in degrees. */
export function hueDelta(a: number, b: number): number {
  let d = (((a - b) % 360) + 540) % 360 - 180;
  if (Object.is(d, -180)) d = 180;
  return d;
}

function hp(b: number, ap: number): number {
  if (b === 0 && ap === 0) return 0;
  const h = (Math.atan2(b, ap) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/**
 * CIEDE2000 perceptual color difference (kL=kC=kH=1).
 * Reference: Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference formula".
 */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = hp(b1, a1p);
  const h2p = hp(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else {
    hbarp = (h1p + h2p) / 2;
    if (Math.abs(h1p - h2p) > 180) {
      hbarp += h1p + h2p < 360 ? 180 : -180;
    }
  }

  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos(((2 * hbarp) * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc;

  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

export function deltaEHex(a: string, b: string): number | null {
  const la = hexToLab(a);
  const lb = hexToLab(b);
  return la && lb ? deltaE2000(la, lb) : null;
}

/** WCAG relative luminance, used for accessible UI color decisions. */
export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two colors, in [1,21]. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Perceptually-even blend in Lab. t=0 returns a, t=1 returns b. */
export function mixLab(a: Lab, b: Lab, t: number): Lab {
  const k = Math.max(0, Math.min(1, t));
  return {
    L: a.L + (b.L - a.L) * k,
    a: a.a + (b.a - a.a) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/** Shift lightness while preserving hue/chroma. Clamped to a displayable range. */
export function adjustLightness(hex: string, deltaL: number): string | null {
  const lab = hexToLab(hex);
  if (!lab) return null;
  return labToHex({ ...lab, L: Math.max(2, Math.min(98, lab.L + deltaL)) });
}

/** Scale chroma, e.g. to derive a muted variant for a Soft season. */
export function adjustChroma(hex: string, factor: number): string | null {
  const lab = hexToLab(hex);
  if (!lab) return null;
  const lch = labToLch(lab);
  return labToHex(lchToLab({ ...lch, C: Math.max(0, Math.min(120, lch.C * factor)) }));
}

/** Round-trip guard used by tests and by callers that must not emit invalid hex. */
export function isRoundTripStable(hex: string, tolerance = 1.5): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const back = labToRgb(rgbToLab(rgb));
  return (
    Math.abs(back.r - rgb.r) <= tolerance &&
    Math.abs(back.g - rgb.g) <= tolerance &&
    Math.abs(back.b - rgb.b) <= tolerance
  );
}
