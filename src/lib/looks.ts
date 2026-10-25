/**
 * Makeup look generation.
 *
 * The point of this module is that looks are COMPUTED, not selected from a
 * preset catalogue. Each colour sent to the YouCam makeup engine is derived from
 * the measured facial colours and the season palette using Lab transformations,
 * and every derived colour records what it came from and what was done to it.
 *
 * All transformations are pure and deterministic. Effect payloads are built to
 * satisfy the engine's documented requirements exactly - notably
 * `palettes.length` must equal the pattern's `colorNum`, which is why the
 * patterns here are deliberately pinned to known single- and multi-colour
 * labels verified against the live pattern catalogues.
 */

import { adjustChroma, adjustLightness, deltaEHex, hexToLab, withLightness, normalizeHex } from "./color.ts";
import type { ColorProfile, PaletteEntry, Season } from "./season.ts";

/** Every finish the makeup engine accepts for at least one category. */
export type Texture =
  | "matte"
  | "satin"
  | "gloss"
  | "shimmer"
  | "metallic"
  | "sheer"
  | "holographic";

/**
 * Eye shadow depth rules. `MIN_SHADOW_L` is the darkest a shadow may be set to,
 * so a deep skin tone is not given a shadow darker than its own features; the
 * drop is how far below the measured skin lightness a shadow sits.
 */
export const MIN_SHADOW_L = 22;
export const LAYER_DEPTH_STEP = 8;

export interface DerivedColor {
  hex: string;
  /** Palette entry or measured feature this came from. */
  derivedFrom: string;
  /** The transformation applied, in words. */
  transform: string;
  /** Lab distance travelled, so a reviewer can see how far the colour moved. */
  deltaE: number | null;
}

export interface LookEffect {
  category: string;
  /** Payload for the YouCam makeup engine. */
  payload: Record<string, unknown>;
  /** Why this effect uses this colour, for the user. */
  rationale: string;
  color: DerivedColor | null;
}

export interface Look {
  id: string;
  name: string;
  occasion: string;
  description: string;
  effects: LookEffect[];
  colors: DerivedColor[];
}

/**
 * Pattern labels pinned from the live catalogues. `colorNum` is the number of
 * palette entries the engine expects for that pattern - a mismatch is a 400.
 */
export const PATTERNS = {
  blush: { label: "1color1", colorNum: 1 },
  eyeShadow: { label: "1color1", colorNum: 1 },
  eyeShadowDuo: { label: "2colors1", colorNum: 2 },
  eyeShadowTrio: { label: "3colors1", colorNum: 3 },
  eyeLiner: { label: "Arabic3", colorNum: 1 },
  eyebrow: { label: "Original2" },
  eyelashes: { label: "Natural1" },
  contour: { label: "OvalFace6" },
  highlighter: { label: "OvalFace2" },
  bronzer: { label: "Bronzer1" },
} as const;

export const LIP_SHAPES = ["original", "plump", "pouty", "heart-shaped"] as const;
export type LipShape = (typeof LIP_SHAPES)[number];

function clampInt(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * Texture-dependent palette fields.
 *
 * The published JSON schema marks these optional, but the live engine rejects a
 * palette that omits them for a given texture - verified against the API, which
 * reports e.g. "effects.blush.palettes[0].glowStrength is required" for a satin
 * blush. Both the payload builders and `validateLook` read this table, so a look
 * cannot be built that the engine will refuse for this reason.
 */
const PALETTE_TEXTURE_RULES: Record<string, { texture: Texture[]; fields: string[] }[]> = {
  lip_color: [
    {
      texture: ["gloss", "satin", "sheer", "holographic", "metallic", "shimmer"],
      fields: ["gloss", "transparencyIntensity"],
    },
    {
      texture: ["shimmer", "metallic", "holographic"],
      fields: ["shimmerColor", "shimmerIntensity"],
    },
  ],
  blush: [
    { texture: ["satin", "shimmer"], fields: ["glowStrength"] },
    { texture: ["shimmer"], fields: ["shimmerColor", "shimmerDensity"] },
  ],
  eye_shadow: [
    { texture: ["shimmer", "metallic"], fields: ["shimmerColor", "shimmerIntensity"] },
    { texture: ["metallic"], fields: ["metallicIntensity"] },
  ],
  eye_liner: [
    { texture: ["shimmer", "metallic"], fields: ["shimmerColor", "shimmerIntensity"] },
    { texture: ["metallic"], fields: ["metallicIntensity"] },
  ],
  eyebrows: [
    {
      texture: ["shimmer"],
      fields: ["shimmerColor", "shimmerIntensity", "shimmerSize", "shimmerDensity"],
    },
  ],
};

/** Legal texture values per category, from the published effect schemas. */
const CATEGORY_TEXTURES: Record<string, Texture[]> = {
  lip_color: ["matte", "gloss", "holographic", "metallic", "satin", "sheer", "shimmer"],
  blush: ["matte", "satin", "shimmer"],
  eye_shadow: ["matte", "shimmer", "metallic"],
  eye_liner: ["matte", "shimmer", "metallic"],
  eyebrows: ["matte", "shimmer"],
};

/** Palette fields the engine requires for this category and texture. */
export function requiredPaletteFields(category: string, texture: string | undefined): string[] {
  const rules = PALETTE_TEXTURE_RULES[category];
  if (!rules || !texture) return [];
  const fields = new Set<string>();
  for (const rule of rules) {
    if (rule.texture.includes(texture as Texture)) rule.fields.forEach((f) => fields.add(f));
  }
  return [...fields];
}

/**
 * Fill in the texture-dependent fields the engine demands, leaving anything the
 * caller set explicitly untouched. Shimmer uses the palette's own colour so the
 * sparkle stays in the measured tone rather than introducing a foreign hue.
 */
function completePalette(
  category: string,
  palette: Record<string, unknown>,
): Record<string, unknown> {
  const legal = CATEGORY_TEXTURES[category];
  let texture = palette.texture as Texture | undefined;
  if (legal && texture && !legal.includes(texture)) {
    // `satin` is a valid lip and blush finish but not an eye finish, where the
    // nearest legal equivalent is `shimmer`.
    texture = legal.includes("shimmer") ? "shimmer" : legal[0];
    palette.texture = texture;
  }
  const intensity = typeof palette.colorIntensity === "number" ? palette.colorIntensity : 50;
  const defaults: Record<string, unknown> = {
    gloss: clampInt(intensity * 0.8),
    transparencyIntensity: clampInt(intensity * 0.5),
    glowStrength: clampInt(intensity),
    shimmerColor: palette.color,
    shimmerIntensity: clampInt(intensity * 0.7),
    shimmerSize: clampInt(intensity * 0.6),
    shimmerDensity: clampInt(intensity * 0.7),
    metallicIntensity: clampInt(intensity * 0.8),
  };
  for (const field of requiredPaletteFields(category, texture)) {
    if (palette[field] === undefined) palette[field] = defaults[field];
  }
  return palette;
}

function derive(
  hex: string,
  derivedFrom: string,
  transform: (h: string) => string | null,
  description: string,
): DerivedColor {
  const out = normalizeHex(transform(hex) ?? hex) ?? hex;
  return {
    hex: out,
    derivedFrom,
    transform: description,
    deltaE: deltaEHex(hex, out),
  };
}

/** Pick palette entries by role, with deterministic fallbacks. */
function paletteByRole(season: Season) {
  const sig = season.palette.filter((p) => p.role === "signature");
  const accent = season.palette.filter((p) => p.role === "accent");
  const neutral = season.palette.filter((p) => p.role === "neutral");
  return {
    signature: sig.length ? sig : season.palette,
    accent: accent.length ? accent : season.palette.slice(-2),
    neutral: neutral.length ? neutral : season.palette.slice(-1),
  };
}

/** Texture policy derived from the season's dominant characteristic. */
export function texturePolicy(profile: ColorProfile) {
  switch (profile.season.dominant) {
    case "bright":
      return { lip: "gloss" as Texture, eye: "shimmer" as Texture, cheek: "satin" as Texture, line: "matte" as Texture };
    case "soft":
      return { lip: "satin" as Texture, eye: "matte" as Texture, cheek: "matte" as Texture, line: "matte" as Texture };
    case "light":
      return { lip: "gloss" as Texture, eye: "satin" as Texture, cheek: "satin" as Texture, line: "matte" as Texture };
    case "deep":
      return { lip: "satin" as Texture, eye: "metallic" as Texture, cheek: "matte" as Texture, line: "matte" as Texture };
    default:
      return { lip: "satin" as Texture, eye: "satin" as Texture, cheek: "satin" as Texture, line: "matte" as Texture };
  }
}

/** Measured brow colour, used so brows match the person rather than a preset. */
function measuredBrow(profile: ColorProfile): { hex: string; source: string } {
  const brow = profile.features.find((f) => f.key === "eyebrow");
  if (brow) return { hex: brow.hex, source: "measured brow colour" };
  const skin = profile.features.find((f) => f.key === "skin");
  return {
    hex: skin ? (adjustLightness(skin.hex, -22) ?? "#3e3834") : "#3e3834",
    source: "skin colour deepened by 22 L* (brow colour unavailable)",
  };
}

/** Skin-tone-anchored contour/bronzer shade. */
function contourShade(profile: ColorProfile): DerivedColor {
  const skin = profile.features.find((f) => f.key === "skin");
  if (!skin) return derive("#a87a5a", "fallback", (h) => h, "unchanged");
  return derive(
    skin.hex,
    "measured skin colour",
    (h) => adjustChroma(adjustLightness(h, -14) ?? h, 0.95),
    "lightness -14 L*, chroma x0.95",
  );
}

/** Skin lightness, or a neutral default when skin was not measured. */
function skinLightness(profile: ColorProfile): number {
  return profile.features.find((f) => f.key === "skin")?.lab.L ?? 62;
}

/**
 * Choose eye shadow colours by LIGHTNESS TARGET rather than by palette role.
 *
 * Picking the "neutral" role sounds reasonable but fails badly for the light and
 * bright seasons, whose neutrals are near-white: the result was an almost-white
 * eye shadow (#fefbf3 for a Bright Spring), which is not a shadow at all.
 *
 * Simply picking the nearest palette colour by lightness is also not enough,
 * because several seasons have no palette colour anywhere near the needed depth -
 * Bright Spring's darkest option is L* 17.4 and its next is L* 54.6, so a target
 * of L* 40 is unreachable by selection alone. So each layer takes a palette
 * colour's hue and chroma and then has its LIGHTNESS SET to the target. That is a
 * computed colour in the palette's own hue family, and it guarantees the depth is
 * usable rather than leaving it to whichever swatch happens to be nearest.
 */
function shadowColors(profile: ColorProfile, count: number, drop: number): DerivedColor[] {
  const skinL = skinLightness(profile);
  const target = Math.max(MIN_SHADOW_L, skinL - drop);
  const palette = profile.season.palette;

  // Distinct palette entries, ordered by how close their own depth is to the
  // target, so the hues we start from are the most appropriate available.
  const ordered = [...palette].sort((a, b) => {
    const da = Math.abs((hexToLab(a.hex)?.L ?? 0) - target);
    const db = Math.abs((hexToLab(b.hex)?.L ?? 0) - target);
    return da - db;
  });

  const chosen: PaletteEntry[] = [];
  for (const entry of ordered) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => c.hex.toLowerCase() === entry.hex.toLowerCase())) continue;
    chosen.push(entry);
  }
  if (chosen.length === 0) chosen.push(palette[0]);

  return chosen.map((entry, i) => {
    const layerL = Math.max(MIN_SHADOW_L, target - LAYER_DEPTH_STEP * i);
    const base = hexToLab(entry.hex)!;
    // `withLightness` reduces chroma only as far as needed to stay in sRGB, so the
    // returned L* is the depth actually achieved rather than the depth requested.
    const result = withLightness(base, layerL);
    return {
      hex: result.hex,
      derivedFrom: `palette "${entry.name}" (${entry.hex})`,
      transform:
        i === 0
          ? `lightness set to L* ${result.lab.L.toFixed(0)} — your skin lightness minus ${drop}`
          : `lightness set to L* ${result.lab.L.toFixed(0)}, another ${LAYER_DEPTH_STEP} L* deeper so it layers underneath`,
      deltaE: deltaEHex(entry.hex, result.hex),
    };
  });
}

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------

export interface BuildLookOptions {
  lipShape?: LipShape;
  /** Skip skin smoothing entirely when the user wants the raw photo. */
  includeSkinSmooth?: boolean;
}

function lipEffect(
  color: DerivedColor,
  texture: Texture,
  intensity: number,
  rationale: string,
  lipShape: LipShape,
): LookEffect {
  const palette = completePalette("lip_color", { color: color.hex, texture, colorIntensity: clampInt(intensity) });
  return {
    category: "lip_color",
    payload: {
      category: "lip_color",
      shape: { name: lipShape },
      // `style` is REQUIRED by the engine even though the docs' minimal example omits it.
      style: { type: "full" },
      palettes: [palette],
    },
    rationale,
    color,
  };
}

function blushEffect(color: DerivedColor, texture: Texture, intensity: number, rationale: string): LookEffect {
  return {
    category: "blush",
    payload: {
      category: "blush",
      pattern: { name: PATTERNS.blush.label },
      palettes: [completePalette("blush", { color: color.hex, texture, colorIntensity: clampInt(intensity) })],
    },
    rationale,
    color,
  };
}

function eyeShadowEffect(
  colors: DerivedColor[],
  texture: Texture,
  intensity: number,
  rationale: string,
): LookEffect {
  const isDuo = colors.length === 2;
  const isTrio = colors.length >= 3;
  const pattern = isTrio ? PATTERNS.eyeShadowTrio : isDuo ? PATTERNS.eyeShadowDuo : PATTERNS.eyeShadow;
  const palettes = colors.slice(0, pattern.colorNum).map((c, i) =>
    completePalette("eye_shadow", {
      color: c.hex,
      texture,
      colorIntensity: clampInt(intensity - i * 12),
    }),
  );
  return {
    category: "eye_shadow",
    payload: { category: "eye_shadow", pattern: { name: pattern.label }, palettes },
    rationale,
    color: colors[0] ?? null,
  };
}

function eyeLinerEffect(color: DerivedColor, intensity: number, rationale: string): LookEffect {
  return {
    category: "eye_liner",
    payload: {
      category: "eye_liner",
      pattern: { name: PATTERNS.eyeLiner.label },
      palettes: [{ color: color.hex, texture: "matte", colorIntensity: clampInt(intensity) }],
    },
    rationale,
    color,
  };
}

function browEffect(color: DerivedColor, definition: number, rationale: string): LookEffect {
  return {
    category: "eyebrows",
    payload: {
      category: "eyebrows",
      pattern: { type: "shape", name: PATTERNS.eyebrow.label, curvature: 0, thickness: 0, definition: clampInt(definition) },
      palettes: [completePalette("eyebrows", { color: color.hex, colorIntensity: 55, texture: "matte" })],
    },
    rationale,
    color,
  };
}

function highlighterEffect(color: DerivedColor, glow: number, rationale: string): LookEffect {
  return {
    category: "highlighter",
    payload: {
      category: "highlighter",
      pattern: { name: PATTERNS.highlighter.label },
      palettes: [
        {
          color: color.hex,
          glowIntensity: clampInt(glow),
          shimmerIntensity: clampInt(glow * 0.7),
          shimmerDensity: clampInt(glow * 0.7),
          shimmerSize: clampInt(glow * 0.6),
          colorIntensity: clampInt(glow * 0.9),
        },
      ],
    },
    rationale,
    color,
  };
}

function contourEffect(color: DerivedColor, intensity: number, rationale: string): LookEffect {
  return {
    category: "contour",
    payload: {
      category: "contour",
      pattern: { name: PATTERNS.contour.label },
      palettes: [{ color: color.hex, colorIntensity: clampInt(intensity) }],
    },
    rationale,
    color,
  };
}

function bronzerEffect(color: DerivedColor, intensity: number, rationale: string): LookEffect {
  return {
    category: "bronzer",
    payload: {
      category: "bronzer",
      pattern: { name: PATTERNS.bronzer.label },
      palettes: [{ color: color.hex, colorIntensity: clampInt(intensity) }],
    },
    rationale,
    color,
  };
}

function skinSmoothEffect(strength: number, colourIntensity: number): LookEffect {
  return {
    category: "skin_smooth",
    payload: {
      category: "skin_smooth",
      skinSmoothStrength: clampInt(strength),
      skinSmoothColorIntensity: clampInt(colourIntensity),
    },
    rationale: "Light skin smoothing so the rendered colours read clearly without looking airbrushed.",
    color: null,
  };
}

/**
 * Build three looks from a profile.
 *
 * The three looks are deliberately distinct in depth and intensity so the user
 * can compare, and each one is anchored to the same measured season so the
 * family of colours stays coherent.
 */
export function buildLooks(profile: ColorProfile, opts: BuildLookOptions = {}): Look[] {
  const lipShape = opts.lipShape ?? "original";
  const includeSmooth = opts.includeSkinSmooth ?? true;
  const { signature, accent, neutral } = paletteByRole(profile.season);
  const tex = texturePolicy(profile);
  const brow = measuredBrow(profile);
  const isSoft = profile.season.dominant === "soft";
  const isBright = profile.season.dominant === "bright";

  const browColor: DerivedColor = { hex: brow.hex, derivedFrom: brow.source, transform: "unchanged", deltaE: 0 };

  // ---- Look 1: everyday ---------------------------------------------------
  const everydayLip = derive(
    accent[0].hex,
    `accent "${accent[0].name}"`,
    (h) => adjustChroma(h, isSoft ? 0.75 : 0.88),
    isSoft ? "chroma x0.75 (muted for a soft season)" : "chroma x0.88 (softened for daytime)",
  );
  const everydayBlush = derive(
    signature[0].hex,
    `signature "${signature[0].name}"`,
    (h) => adjustChroma(adjustLightness(h, 6) ?? h, 0.72),
    "lightness +6 L*, chroma x0.72",
  );
  // Shadows are chosen by depth, not by palette role: a "neutral" role is
  // near-white for the light and bright seasons and makes an unusable shadow.
  const everydayShadows = shadowColors(profile, 1, 22);
  const everydayEye = everydayShadows[0];

  const everyday: Look = {
    id: "everyday",
    name: "Everyday",
    occasion: "Daylight, work, errands",
    description: `A low-contrast version of your ${profile.season.name} palette, tuned so the colour supports your face rather than arriving before you do.`,
    effects: [
      ...(includeSmooth ? [skinSmoothEffect(35, 25)] : []),
      lipEffect(everydayLip, isSoft ? "satin" : tex.lip, 55, "Your accent colour with the saturation pulled back for daytime.", lipShape),
      blushEffect(everydayBlush, tex.cheek, 42, "A lifted, softened version of your signature colour for a natural flush.", ),
      eyeShadowEffect(everydayShadows, "matte", 38, `One colour at about L* ${(skinLightness(profile) - 22).toFixed(0)}, deep enough to read as shadow on your skin tone.`),
      browEffect(browColor, 15, `Brows tinted with your ${brow.source}, so the shape matches your own hair rather than a preset.`),
    ],
    colors: [everydayLip, everydayBlush, everydayEye, browColor],
  };

  // ---- Look 2: signature --------------------------------------------------
  const sigLip = derive(
    signature[0].hex,
    `signature "${signature[0].name}"`,
    (h) => h,
    "unchanged - this is the season's own signature colour",
  );
  const sigBlush = derive(
    signature[1]?.hex ?? signature[0].hex,
    `signature "${signature[1]?.name ?? signature[0].name}"`,
    (h) => adjustChroma(h, 0.85),
    "chroma x0.85",
  );
  const signatureShadows = shadowColors(profile, 2, 30);
  const sigEye = signatureShadows[0];
  const sigLiner = derive(
    accent[0].hex,
    `accent "${accent[0].name}"`,
    (h) => adjustChroma(adjustLightness(h, -26) ?? h, 0.85),
    "lightness -26 L*, chroma x0.85 (deepened into a liner shade)",
  );
  const sigHighlight = derive(
    neutral[0].hex,
    `neutral "${neutral[0].name}"`,
    (h) => adjustLightness(h, 8),
    "lightness +8 L*",
  );

  const signatureLook: Look = {
    id: "signature",
    name: "Signature",
    occasion: "Dinners, portraits, being photographed",
    description: `Your ${profile.season.name} palette at full strength, including a liner shade computed by deepening your accent colour rather than picking a black.`,
    effects: [
      ...(includeSmooth ? [skinSmoothEffect(45, 35)] : []),
      lipEffect(sigLip, tex.lip, isSoft ? 65 : 78, "Your season's signature colour at close to full intensity.", lipShape),
      blushEffect(sigBlush, tex.cheek, 52, "A second palette colour so the cheek reads as part of the same family.", ),
      eyeShadowEffect(signatureShadows, tex.eye, 55, "Two palette colours layered, the second deepened so the pair reads as a gradient rather than one flat shade."),
      eyeLinerEffect(sigLiner, 62, "Computed by darkening your accent colour, which keeps the line in-family instead of harsh black."),
      highlighterEffect(sigHighlight, 42, "A lifted neutral from your palette for a glow that matches your undertone."),
      browEffect(browColor, 22, `Brows defined with your ${brow.source}.`),
    ],
    colors: [sigLip, sigBlush, sigEye, sigLiner, sigHighlight, browColor],
  };

  // ---- Look 3: evening ----------------------------------------------------
  const eveLip = derive(
    accent[0].hex,
    `accent "${accent[0].name}"`,
    (h) => adjustChroma(adjustLightness(h, -12) ?? h, isBright ? 1.15 : 1.0),
    isBright ? "lightness -12 L*, chroma x1.15 (deepened and intensified)" : "lightness -12 L*",
  );
  const eveBlush = derive(
    accent[1]?.hex ?? accent[0].hex,
    `accent "${accent[1]?.name ?? accent[0].name}"`,
    (h) => adjustChroma(h, 0.8),
    "chroma x0.80",
  );
  const eveningShadows = shadowColors(profile, 3, 40);
  const eveEye = eveningShadows[0];
  const eveLiner = derive(
    accent[0].hex,
    `accent "${accent[0].name}"`,
    (h) => adjustChroma(adjustLightness(h, -38) ?? h, 0.8),
    "lightness -38 L*, chroma x0.80 (near-black in-family liner)",
  );
  const eveContour = contourShade(profile);
  const eveBronzer = derive(
    signature[0].hex,
    `signature "${signature[0].name}"`,
    (h) => adjustChroma(adjustLightness(h, -8) ?? h, 0.7),
    "lightness -8 L*, chroma x0.70",
  );
  const eveHighlight = derive(
    neutral[0].hex,
    `neutral "${neutral[0].name}"`,
    (h) => adjustLightness(h, 14),
    "lightness +14 L*",
  );

  const evening: Look = {
    id: "evening",
    name: "Evening",
    occasion: "Low light, events, photography",
    description: `A deeper, higher-contrast reading of your ${profile.season.name} palette, with contour and bronzer computed from your own measured skin colour.`,
    effects: [
      ...(includeSmooth ? [skinSmoothEffect(50, 40)] : []),
      lipEffect(eveLip, isBright ? "gloss" : "satin", 82, "Your accent deepened and intensified so it holds up in low light.", lipShape),
      blushEffect(eveBlush, tex.cheek, 50, "A second accent, kept muted so it does not compete with the lip.", ),
      eyeShadowEffect(eveningShadows, "metallic", 68, "Three palette colours, each deepened in turn so the deepest sits along the lash line."),
      eyeLinerEffect(eveLiner, 70, "The deepest in-family liner we can compute from your accent colour."),
      contourEffect(eveContour, 38, "Computed from your measured skin colour, deepened and slightly desaturated so it reads as shadow."),
      bronzerEffect(eveBronzer, 32, "A warm depth layer derived from your signature colour."),
      highlighterEffect(eveHighlight, 55, "A stronger lift of your neutral for evening light."),
      browEffect(browColor, 30, `Brows defined with your ${brow.source}.`),
    ],
    colors: [eveLip, eveBlush, eveEye, eveLiner, eveContour, eveBronzer, eveHighlight, browColor],
  };

  return [everyday, signatureLook, evening];
}

/**
 * Turn a look into the exact request body the makeup engine expects.
 * Kept separate from the look itself so tests can assert payload shape without
 * caring about the prose.
 */
export function toMakeupRequest(look: Look): { effects: Record<string, unknown>[]; version: string } {
  return { effects: look.effects.map((e) => e.payload), version: "1.0" };
}

/**
 * Patterns we have checked against the live catalogues, with the number of
 * palette entries each one requires.
 *
 * This registry exists because the engine rejects a payload whose
 * `palettes.length` does not equal the pattern's `colorNum`, and because a
 * misspelled pattern name is rejected too. Two pattern names I initially guessed
 * (`eyeliner 1color1`, `eyebrows Natural1`) do not exist in the catalogues, so
 * every name used by this app must be listed here and verified.
 */
export const VERIFIED_PATTERNS: Record<string, { colorNum: number; note: string }> = {
  "blush:1color1": { colorNum: 1, note: "single-colour blush" },
  "blush:2colors1": { colorNum: 2, note: "two-colour blush" },
  "blush:3colors1": { colorNum: 3, note: "three-colour blush" },
  "eye_shadow:1color1": { colorNum: 1, note: "single-colour shadow" },
  "eye_shadow:2colors1": { colorNum: 2, note: "two-colour shadow" },
  "eye_shadow:3colors1": { colorNum: 3, note: "three-colour shadow" },
  "eye_liner:Arabic3": { colorNum: 1, note: "one-colour liner" },
  "eyebrows:Original2": { colorNum: 1, note: "brow shape preset" },
  "eyelashes:Natural1": { colorNum: 1, note: "lash preset" },
  "contour:OvalFace6": { colorNum: 1, note: "oval-face contour" },
  "highlighter:OvalFace2": { colorNum: 1, note: "oval-face highlight" },
  "bronzer:Bronzer1": { colorNum: 1, note: "bronzer preset" },
};

/** Look up a verified pattern, or undefined when it is not registered. */
export function verifiedPattern(
  category: string,
  name: string,
): { colorNum: number; note: string } | undefined {
  return VERIFIED_PATTERNS[`${category}:${name}`];
}

/**
 * Validate a generated look against the engine's structural rules before we
 * spend a unit on it. Returns a list of problems; empty means safe to send.
 */
export function validateLook(look: Look): string[] {
  const problems: string[] = [];

  for (const effect of look.effects) {
    const p = effect.payload;
    if (!p.category) problems.push(`${effect.category}: missing category`);

    // skin_smooth carries no pattern or palette.
    if (effect.category === "skin_smooth") continue;

    const palettes = p.palettes as Record<string, unknown>[] | undefined;

    if (effect.category === "lip_color") {
      if (!p.shape) problems.push("lip_color: missing shape");
      if (!p.style) problems.push("lip_color: missing required style");
    } else if (effect.category === "eyebrows") {
      const pattern = p.pattern as Record<string, unknown> | undefined;
      if (!pattern?.name) problems.push("eyebrows: missing pattern name");
      if (pattern?.type !== "shape" && pattern?.type !== "color") {
        problems.push("eyebrows: pattern.type must be shape or color");
      }
    } else if (effect.category === "foundation" || effect.category === "concealer") {
      // No pattern object; palette fields are checked below.
    } else {
      const pattern = p.pattern as Record<string, unknown> | undefined;
      if (!pattern?.name) problems.push(`${effect.category}: missing pattern name`);
    }

    if (!palettes || palettes.length === 0) {
      problems.push(`${effect.category}: no palettes`);
      continue;
    }

    // The pattern's own colorNum decides how many palettes are legal.
    const patternName =
      (p.pattern as { name?: string } | undefined)?.name ??
      (effect.category === "lip_color" ? (p.shape as { name?: string })?.name : undefined);

    if (patternName) {
      if (effect.category === "lip_color") {
        if (!LIP_SHAPES.includes(patternName as LipShape)) {
          problems.push(`lip_color: lip shape "${patternName}" is not a known label`);
        }
      } else {
        const spec = verifiedPattern(effect.category, patternName);
        if (!spec) {
          problems.push(
            `${effect.category}: pattern "${patternName}" is not in the verified registry`,
          );
        } else if (palettes.length !== spec.colorNum) {
          problems.push(
            `${effect.category}: pattern "${patternName}" takes ${spec.colorNum} palette entries, got ${palettes.length}`,
          );
        }
      }
    }

    for (const [i, pal] of palettes.entries()) {
      const hex = pal.color;
      if (typeof hex !== "string" || !hexToLab(hex)) {
        problems.push(`${effect.category}[${i}]: colour ${String(hex)} is not valid hex`);
      }
      const intensity = pal.colorIntensity;
      if (typeof intensity !== "number" || intensity < 0 || intensity > 100) {
        problems.push(`${effect.category}[${i}]: colorIntensity ${String(intensity)} out of 0..100`);
      }
      // The engine rejects a palette that omits a field its texture implies.
      for (const field of requiredPaletteFields(effect.category, pal.texture as string | undefined)) {
        if (pal[field] === undefined) {
          problems.push(
            `${effect.category}[${i}]: texture "${String(pal.texture)}" requires "${field}"`,
          );
        }
      }
      const legal = CATEGORY_TEXTURES[effect.category];
      if (legal && pal.texture !== undefined && !legal.includes(pal.texture as Texture)) {
        problems.push(
          `${effect.category}[${i}]: texture "${String(pal.texture)}" is not one of ${legal.join(", ")}`,
        );
      }
    }
  }

  if (look.effects.length === 0) problems.push("look has no effects");
  return problems;
}
