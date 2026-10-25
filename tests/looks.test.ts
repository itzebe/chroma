/**
 * Look-generation tests.
 *
 * The most valuable assertion here is that every generated look passes
 * `validateLook`, which encodes the makeup engine's structural rules (pattern
 * names, palette counts, required fields). A look that fails it would be a 400
 * against the live API, so this suite is the guard that keeps payloads shippable
 * when credits are unavailable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, nearestPaletteEntry, type ColorProfile } from "../src/lib/season.ts";
import {
  MIN_SHADOW_L,
  buildLooks,
  toMakeupRequest,
  validateLook,
  texturePolicy,
  PATTERNS,
  verifiedPattern,
  LIP_SHAPES,
  requiredPaletteFields,
} from "../src/lib/looks.ts";
import { hexToLab, normalizeHex, deltaEHex } from "../src/lib/color.ts";

// Verbatim real YouCam response, 2026-10-24 (fixture).
const LIVE = {
  skin_color: "#ba8e6e",
  lip_color: "#c98e93",
  eye_color: "#553829",
  eyebrow_color: "#3e3834",
  eye_color_name: "Brown",
};

const PROFILES: Record<string, ColorProfile> = {
  live: classify({ colors: LIVE, quality: { frontal: "good", lighting: "good" } }),
  warmLight: classify({ colors: { skin_color: "#f7e3c8", lip_color: "#e8907a", eye_color: "#8a9a5b", eyebrow_color: "#a08a6a" }, quality: {} }),
  coolLight: classify({ colors: { skin_color: "#f2d5cf", lip_color: "#d98a9e", eye_color: "#7a9bb5", eyebrow_color: "#8a7a72" }, quality: {} }),
  deepWarm: classify({ colors: { skin_color: "#8a5a3b", lip_color: "#b56a52", eye_color: "#5a3a1a", eyebrow_color: "#3a2a1a" }, quality: {} }),
  deepCool: classify({ colors: { skin_color: "#5c3d33", lip_color: "#9c5a70", eye_color: "#2a3a55", eyebrow_color: "#2a2622" }, quality: {} }),
  bright: classify({ colors: { skin_color: "#c9a06b", lip_color: "#e0447a", eye_color: "#1a2a3a", eyebrow_color: "#1e1a16" }, quality: {} }),
  soft: classify({ colors: { skin_color: "#c4a894", lip_color: "#b08a8a", eye_color: "#8a7a6a", eyebrow_color: "#8a7a70" }, quality: {} }),
};

test("every profile yields exactly three distinct looks", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    const looks = buildLooks(profile);
    assert.equal(looks.length, 3, `${name}: expected 3 looks`);
    assert.deepEqual(
      looks.map((l) => l.id),
      ["everyday", "signature", "evening"],
      `${name}: look ids must be stable`,
    );
    for (const look of looks) {
      assert.ok(look.name && look.description && look.occasion, `${name}/${look.id} incomplete`);
      assert.ok(look.effects.length > 0, `${name}/${look.id} has no effects`);
    }
  }
});

test("EVERY generated look passes structural validation", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    for (const look of buildLooks(profile)) {
      const problems = validateLook(look);
      assert.deepEqual(problems, [], `${name}/${look.id} would be rejected by the engine`);
    }
  }
});

test("every generated look passes validation with each lip shape", () => {
  for (const lipShape of LIP_SHAPES) {
    for (const look of buildLooks(PROFILES.live, { lipShape })) {
      const problems = validateLook(look);
      assert.deepEqual(problems, [], `lipShape=${lipShape} ${look.id} invalid`);
    }
  }
});

test("omitting skin smoothing removes exactly the skin_smooth effect", () => {
  const withSmooth = buildLooks(PROFILES.live, { includeSkinSmooth: true });
  const without = buildLooks(PROFILES.live, { includeSkinSmooth: false });
  for (let i = 0; i < withSmooth.length; i++) {
    const a = withSmooth[i].effects.filter((e) => e.category === "skin_smooth").length;
    const b = without[i].effects.filter((e) => e.category === "skin_smooth").length;
    assert.equal(a, 1);
    assert.equal(b, 0);
    assert.equal(without[i].effects.length, withSmooth[i].effects.length - 1);
  }
});

test("lip_color always carries the required style field", () => {
  for (const profile of Object.values(PROFILES)) {
    for (const look of buildLooks(profile)) {
      const lip = look.effects.find((e) => e.category === "lip_color")!;
      assert.ok(lip, `${look.id} has no lip_color`);
      assert.ok(lip.payload.style, `${look.id} lip_color is missing the required style`);
      assert.ok(lip.payload.shape, `${look.id} lip_color is missing shape`);
      assert.deepEqual(lip.payload.style, { type: "full" });
    }
  }
});

test("palette counts match the declared pattern colorNum exactly", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    for (const look of buildLooks(profile)) {
      for (const effect of look.effects) {
        if (effect.category === "skin_smooth") continue;
        const palettes = effect.payload.palettes as unknown[];
        assert.ok(Array.isArray(palettes) && palettes.length > 0, `${effect.category} has no palettes`);

        const patternName = (effect.payload.pattern as { name?: string } | undefined)?.name;
        if (!patternName) continue;
        const spec = verifiedPattern(effect.category, patternName);
        assert.ok(spec, `${name}/${look.id}: pattern ${effect.category}:${patternName} is not verified`);
        assert.equal(
          palettes.length,
          spec!.colorNum,
          `${effect.category}:${patternName} sent ${palettes.length} palettes but takes ${spec!.colorNum}`,
        );
      }
    }
  }
});

test("every pattern the app emits is in the verified registry", () => {
  // Guards the exact class of bug that produced a live 400: a pattern name that
  // looks plausible but does not exist in the catalogues.
  for (const profile of Object.values(PROFILES)) {
    for (const look of buildLooks(profile)) {
      for (const effect of look.effects) {
        if (effect.category === "skin_smooth" || effect.category === "lip_color") continue;
        const patternName = (effect.payload.pattern as { name?: string } | undefined)?.name;
        assert.ok(patternName, `${effect.category} has no pattern name`);
        assert.ok(
          verifiedPattern(effect.category, patternName!),
          `${effect.category}:${patternName} must be registered as verified`,
        );
      }
    }
  }
});

test("multi-colour eye shadow uses a duo/trio pattern, never a 1-colour one", () => {
  for (const profile of Object.values(PROFILES)) {
    for (const look of buildLooks(profile)) {
      const shadow = look.effects.find((e) => e.category === "eye_shadow")!;
      const palettes = shadow.payload.palettes as unknown[];
      const pattern = (shadow.payload.pattern as { name: string }).name;
      if (palettes.length === 2) assert.equal(pattern, PATTERNS.eyeShadowDuo.label);
      if (palettes.length === 3) assert.equal(pattern, PATTERNS.eyeShadowTrio.label);
      if (palettes.length === 1) assert.equal(pattern, PATTERNS.eyeShadow.label);
    }
  }
});

test("all generated colours are valid normalised hex", () => {
  for (const profile of Object.values(PROFILES)) {
    for (const look of buildLooks(profile)) {
      for (const c of look.colors) {
        assert.ok(hexToLab(c.hex), `${look.id} produced invalid hex ${c.hex}`);
        assert.equal(normalizeHex(c.hex), c.hex, `${look.id} produced non-normalised hex ${c.hex}`);
      }
    }
  }
});

test("every derived colour explains where it came from and what was done", () => {
  for (const profile of Object.values(PROFILES)) {
    for (const look of buildLooks(profile)) {
      for (const c of look.colors) {
        assert.ok(c.derivedFrom.length > 0, `${look.id}: colour ${c.hex} has no provenance`);
        assert.ok(c.transform.length > 0, `${look.id}: colour ${c.hex} has no transform note`);
        assert.ok(c.deltaE === null || c.deltaE >= 0, `${look.id}: negative deltaE`);
      }
    }
  }
});

test("derived colours stay in-family with the season palette", () => {
  // A look that wanders far from the palette would not be the user's season.
  // 30 deltaE is a deliberately generous ceiling: it catches a colour that has
  // left the family entirely, while allowing deliberate deepening for liner.
  for (const [name, profile] of Object.entries(PROFILES)) {
    for (const look of buildLooks(profile)) {
      for (const c of look.colors) {
        const near = nearestPaletteEntry(c.hex, profile.season);
        assert.ok(near, `${name}/${look.id}: could not match ${c.hex} to the palette`);
        assert.ok(
          near.distance < 30,
          `${name}/${look.id}: ${c.hex} is ${near.distance.toFixed(1)} from the palette - out of season`,
        );
      }
    }
  }
});

test("looks are deterministic", () => {
  for (const profile of Object.values(PROFILES)) {
    const a = JSON.stringify(buildLooks(profile));
    const b = JSON.stringify(buildLooks(profile));
    assert.equal(a, b, "buildLooks must be deterministic");
  }
});

test("the three looks actually differ from each other", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    const looks = buildLooks(profile);
    const lips = looks.map((l) => {
      const lip = l.effects.find((e) => e.category === "lip_color")!;
      return (lip.payload.palettes as { color: string }[])[0].color;
    });
    assert.equal(new Set(lips).size, 3, `${name}: the three looks should not share a lip colour`);
    const d1 = deltaEHex(lips[0], lips[2])!;
    assert.ok(d1 > 2, `${name}: everyday and evening lips are nearly identical (${d1.toFixed(1)})`);
  }
});

test("different seasons produce different looks", () => {
  const lipBySeason = new Map<string, string>();
  for (const [name, profile] of Object.entries(PROFILES)) {
    const lip = buildLooks(profile)[1].effects.find((e) => e.category === "lip_color")!;
    lipBySeason.set(name, (lip.payload.palettes as { color: string }[])[0].color);
  }
  assert.ok(new Set(lipBySeason.values()).size >= 5, `expected varied lips, got ${[...lipBySeason.values()].join(", ")}`);
});

test("texture policy follows the season's dominant characteristic", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    const t = texturePolicy(profile);
    for (const v of [t.lip, t.eye, t.cheek, t.line]) {
      assert.ok(["matte", "satin", "gloss", "shimmer", "metallic"].includes(v), `${name} bad texture ${v}`);
    }
    if (profile.season.dominant === "bright") assert.equal(t.lip, "gloss");
    if (profile.season.dominant === "soft") assert.equal(t.eye, "matte");
  }
});

test("toMakeupRequest emits a versioned effects array matching the look", () => {
  for (const profile of Object.values(PROFILES)) {
    for (const look of buildLooks(profile)) {
      const req = toMakeupRequest(look);
      assert.equal(req.version, "1.0");
      assert.equal(req.effects.length, look.effects.length);
      for (const e of req.effects) assert.ok(typeof e.category === "string");
    }
  }
});

test("validateLook catches the mistakes the live API rejects", () => {
  const look = buildLooks(PROFILES.live)[1];
  assert.deepEqual(validateLook(look), []);

  // Missing style on lip_color (the exact error the engine returned).
  const noStyle = structuredClone(look);
  const lip = noStyle.effects.find((e) => e.category === "lip_color")!;
  delete (lip.payload as Record<string, unknown>).style;
  assert.ok(validateLook(noStyle).some((p) => /style/.test(p)));

  // Wrong palette count for a 1-colour pattern.
  const tooMany = structuredClone(look);
  const blush = tooMany.effects.find((e) => e.category === "blush")!;
  (blush.payload.palettes as unknown[]).push({ color: "#ffffff", colorIntensity: 10 });
  assert.ok(validateLook(tooMany).some((p) => /palette entries/.test(p)));

  // Invalid hex.
  const badHex = structuredClone(look);
  const bad = badHex.effects.find((e) => e.category === "blush")!;
  (bad.payload.palettes as { color: string }[])[0].color = "not-a-color";
  assert.ok(validateLook(badHex).some((p) => /not valid hex/.test(p)));

  // Out-of-range intensity.
  const badIntensity = structuredClone(look);
  const bi = badIntensity.effects.find((e) => e.category === "blush")!;
  (bi.payload.palettes as { colorIntensity: number }[])[0].colorIntensity = 150;
  assert.ok(validateLook(badIntensity).some((p) => /colorIntensity/.test(p)));

  // Missing pattern name.
  const noPattern = structuredClone(look);
  const np = noPattern.effects.find((e) => e.category === "blush")!;
  delete (np.payload as Record<string, unknown>).pattern;
  assert.ok(validateLook(noPattern).some((p) => /pattern name/.test(p)));
});

test("brow colour follows the measured brow, not a hardcoded brown", () => {
  const a = classify({ colors: { ...LIVE, eyebrow_color: "#3e3834" }, quality: {} });
  const b = classify({ colors: { ...LIVE, eyebrow_color: "#8a5a3b" }, quality: {} });
  const browA = buildLooks(a)[0].effects.find((e) => e.category === "eyebrows")!;
  const browB = buildLooks(b)[0].effects.find((e) => e.category === "eyebrows")!;
  const hexA = (browA.payload.palettes as { color: string }[])[0].color;
  const hexB = (browB.payload.palettes as { color: string }[])[0].color;
  assert.notEqual(hexA, hexB, "brow colour must track the measured brow colour");
  assert.equal(hexA, "#3e3834");
  assert.equal(hexB, "#8a5a3b");
});

test("brow colour falls back to a deepened skin tone when the API omits brows", () => {
  const p = classify({ colors: { skin_color: "#ba8e6e", lip_color: "#c98e93", eye_color: "#553829" }, quality: {} });
  const brow = buildLooks(p)[0].effects.find((e) => e.category === "eyebrows")!;
  const hex = (brow.payload.palettes as { color: string }[])[0].color;
  assert.ok(hexToLab(hex));
  const skinL = hexToLab("#ba8e6e")!.L;
  const browL = hexToLab(hex)!.L;
  assert.ok(browL < skinL, "a fallback brow must be darker than the skin");
  assert.match(brow.rationale, /unavailable/);
});

test("eye shadow is always deeper than the skin, and never a near-white highlight", () => {
  // Regression: selecting the palette's "neutral" role gave a Bright Spring an
  // eye shadow of #fefbf3, which is a highlight, not a shadow.
  //
  // The invariant is "meaningfully deeper than the skin", not a fixed 10 L* drop:
  // for a deep skin tone (L* 29) a 10 L* drop would demand L* 19, which is darker
  // than the person's own brows (L* 24) and eyeliner (L* 17) - makeup does not
  // work that way, so the absolute floor correctly wins there.
  for (const [name, profile] of Object.entries(PROFILES)) {
    const skinL = profile.features.find((f) => f.key === "skin")?.lab.L;
    if (skinL === undefined) continue;
    for (const look of buildLooks(profile)) {
      const shadow = look.effects.find((e) => e.category === "eye_shadow")!;
      const palettes = shadow.payload.palettes as { color: string }[];
      const darkest = Math.min(...palettes.map((p) => hexToLab(p.color)!.L));
      assert.ok(
        darkest < skinL - 4,
        `${name}/${look.id}: shadow L* ${darkest.toFixed(1)} is not meaningfully darker than skin L* ${skinL.toFixed(1)}`,
      );
      assert.ok(
        darkest < 80,
        `${name}/${look.id}: shadow L* ${darkest.toFixed(1)} is a highlight, not a shadow`,
      );
    }
  }
});

test("layered eye shadows are all at a usable depth", () => {
  // Each layer is set to its own target lightness, which can hit the absolute
  // floor on very deep skin tones, so the layers are not strictly monotonic. What
  // must hold is that every layer is at a depth that reads as shadow rather than
  // as a second skin tone or a highlight.
  for (const [name, profile] of Object.entries(PROFILES)) {
    const skinL = profile.features.find((f) => f.key === "skin")?.lab.L;
    if (skinL === undefined) continue;
    for (const look of buildLooks(profile)) {
      const shadow = look.effects.find((e) => e.category === "eye_shadow")!;
      const ls = (shadow.payload.palettes as { color: string }[]).map((p) => hexToLab(p.color)!.L);
      for (const [i, l] of ls.entries()) {
        assert.ok(
          l >= MIN_SHADOW_L - 0.5 && l <= Math.max(MIN_SHADOW_L, skinL - 22) + 0.5,
          `${name}/${look.id}: layer ${i} at L* ${l.toFixed(1)} is outside the usable shadow range`,
        );
      }
    }
  }
});

test("no two eye shadow layers share the same colour", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    for (const look of buildLooks(profile)) {
      const shadow = look.effects.find((e) => e.category === "eye_shadow")!;
      const hexes = (shadow.payload.palettes as { color: string }[]).map((p) => p.color.toLowerCase());
      assert.equal(new Set(hexes).size, hexes.length, `${name}/${look.id}: duplicate shadow colours ${hexes.join(", ")}`);
    }
  }
});

test("every palette carries the fields its texture requires", () => {
  // The live engine rejected the signature look with exactly these omissions
  // (2026-10-25): "effects.blush.palettes[0].glowStrength is required;
  // effects.eye_shadow.palettes[0].shimmerColor is required; ...". The published
  // schema calls them optional, so only the API reveals the requirement.
  for (const [name, profile] of Object.entries(PROFILES)) {
    for (const look of buildLooks(profile)) {
      for (const effect of look.effects) {
        for (const [i, pal] of ((effect.payload.palettes as Record<string, unknown>[]) ?? []).entries()) {
          for (const field of requiredPaletteFields(effect.category, pal.texture as string)) {
            assert.ok(
              pal[field] !== undefined,
              `${name}/${look.id}/${effect.category}[${i}] texture=${String(pal.texture)} needs ${field}`,
            );
          }
        }
      }
    }
  }
});

test("a satin eye texture is corrected to one the engine accepts", () => {
  // `satin` is legal for lips and blush but not for eye shadow, whose enum is
  // matte|shimmer|metallic. Seasons with a `light` dominant request satin eyes.
  const satinEye = classify({
    colors: { skin_color: "#f2d5cf", lip_color: "#d98a9e", eye_color: "#7a9bb5", eyebrow_color: "#8a7a72" },
    quality: {},
  });
  assert.equal(texturePolicy(satinEye).eye, "satin", "fixture should still request satin eyes");
  const shadow = buildLooks(satinEye)[1].effects.find((e) => e.category === "eye_shadow")!;
  const textures = (shadow.payload.palettes as { texture: string }[]).map((p) => p.texture);
  assert.ok(
    textures.every((t) => ["matte", "shimmer", "metallic"].includes(t)),
    `eye shadow textures must be legal, got ${textures.join(", ")}`,
  );
});

test("validateLook rejects a texture the category does not allow", () => {
  const look = structuredClone(buildLooks(PROFILES.live)[1]);
  const shadow = look.effects.find((e) => e.category === "eye_shadow")!;
  (shadow.payload.palettes as { texture: string }[])[0].texture = "satin";
  assert.ok(validateLook(look).some((p) => /not one of/.test(p)));
});
