/**
 * Color-science tests.
 *
 * The CIEDE2000 cases below are the published reference pairs from
 * Sharma, Wu & Dalal (2005) - they are the industry's standard conformance set,
 * so a passing suite means our implementation matches the specification rather
 * than merely being self-consistent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHex,
  toHex,
  normalizeHex,
  rgbToLab,
  labToRgb,
  hexToLab,
  labToLch,
  lchToLab,
  labToHex,
  hueDelta,
  deltaE2000,
  deltaEHex,
  contrastRatio,
  isInSrgbGamut,
  withLightness,
  hexToLch,
  mixLab,
  adjustLightness,
  adjustChroma,
  isRoundTripStable,
} from "../src/lib/color.ts";

test("parseHex accepts 3- and 6-digit forms with or without hash", () => {
  assert.deepEqual(parseHex("#ff0000"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseHex("ff0000"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseHex("#f00"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseHex("#FFF"), { r: 255, g: 255, b: 255 });
});

test("parseHex rejects malformed input instead of guessing", () => {
  for (const bad of ["", "#", "#ff", "#ffff", "#fffff", "#gggggg", "red", "#12345g", "rgb(1,2,3)"]) {
    assert.equal(parseHex(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("parseHex rejects non-string input", () => {
  assert.equal(parseHex(undefined as unknown as string), null);
  assert.equal(parseHex(null as unknown as string), null);
  assert.equal(parseHex(123 as unknown as string), null);
});

test("toHex clamps out-of-gamut channels", () => {
  assert.equal(toHex({ r: 300, g: -20, b: 128 }), "#ff0080");
});

test("normalizeHex canonicalises and validates", () => {
  assert.equal(normalizeHex("#F00"), "#ff0000");
  assert.equal(normalizeHex("BA8E6E"), "#ba8e6e");
  assert.equal(normalizeHex("nope"), null);
});

test("sRGB to Lab matches published reference values", () => {
  const cases: [string, [number, number, number]][] = [
    ["#ffffff", [100, 0, 0]],
    ["#000000", [0, 0, 0]],
    ["#ff0000", [53.2408, 80.0925, 67.2032]],
    ["#00ff00", [87.7347, -86.1827, 83.1793]],
    ["#0000ff", [32.297, 79.1875, -107.8602]],
  ];
  for (const [hex, [L, a, b]] of cases) {
    const lab = hexToLab(hex)!;
    assert.ok(Math.abs(lab.L - L) < 0.01, `${hex} L ${lab.L} != ${L}`);
    assert.ok(Math.abs(lab.a - a) < 0.01, `${hex} a ${lab.a} != ${a}`);
    assert.ok(Math.abs(lab.b - b) < 0.01, `${hex} b ${lab.b} != ${b}`);
  }
});

test("neutral grey has zero chroma and reports hue 0 rather than NaN", () => {
  const lch = labToLch(rgbToLab({ r: 128, g: 128, b: 128 }));
  assert.ok(lch.C < 0.001);
  assert.equal(lch.h, 0);
});

test("Lab round-trips back to the original sRGB values", () => {
  for (const hex of ["#ba8e6e", "#c98e93", "#553829", "#3e3834", "#0b0b0b", "#ffffff"]) {
    assert.ok(isRoundTripStable(hex), `${hex} failed round trip`);
    const back = labToHex(hexToLab(hex)!);
    assert.equal(back, hex);
  }
});

test("labToRgb clamps out-of-gamut results to valid channels", () => {
  const rgb = labToRgb({ L: 100, a: 120, b: -120 });
  for (const c of [rgb.r, rgb.g, rgb.b]) {
    assert.ok(c >= 0 && c <= 255, `channel ${c} out of range`);
  }
});

test("lchToLab inverts labToLch", () => {
  const lab = hexToLab("#ba8e6e")!;
  const back = lchToLab(labToLch(lab));
  assert.ok(Math.abs(back.L - lab.L) < 1e-9);
  assert.ok(Math.abs(back.a - lab.a) < 1e-9);
  assert.ok(Math.abs(back.b - lab.b) < 1e-9);
});

test("hueDelta returns the shortest signed angular distance", () => {
  assert.equal(hueDelta(10, 350), 20);
  assert.equal(hueDelta(350, 10), -20);
  // Exactly opposite hues: the sign is a tie and is pinned by convention to +180.
  assert.equal(hueDelta(180, 0), 180);
  assert.equal(hueDelta(0, 180), 180);
});

// --- CIEDE2000 conformance (Sharma, Wu & Dalal 2005 reference data) ----------

test("deltaE2000 matches the published reference pairs", () => {
  const cases: [number[], number[], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0],
    [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, -1, 2], [50, 0, 0], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
    [[50, 2.49, -0.001], [50, -2.49, 0.0012], 7.2195],
    [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
    [[50, -0.001, 2.49], [50, 0.001, -2.49], 4.8045],
    [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
    [[50, 2.5, 0], [50, 3.2972, 0], 1.0],
    [[50, 2.5, 0], [50, 1.8634, 0.5757], 1.0],
    [[50, 2.5, 0], [50, 3.2592, 0.335], 1.0],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
    [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
    [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [a, b, expected] of cases) {
    const got = deltaE2000({ L: a[0], a: a[1], b: a[2] }, { L: b[0], a: b[1], b: b[2] });
    assert.ok(
      Math.abs(got - expected) < 0.0001,
      `deltaE2000(${a}) vs (${b}) = ${got}, expected ${expected}`,
    );
  }
});

test("deltaE2000 is zero for identical colors and symmetric", () => {
  const lab = { L: 62.4, a: 12.4, b: 23.5 };
  assert.equal(deltaE2000(lab, lab), 0);
  const other = { L: 26.5, a: 10.9, b: 14.6 };
  assert.ok(Math.abs(deltaE2000(lab, other) - deltaE2000(other, lab)) < 1e-9);
});

test("deltaEHex returns null for invalid input rather than a wrong number", () => {
  // Note: "bad" IS valid hex (#bbaadd) - 3-digit shorthand - so it must parse.
  assert.ok(deltaEHex("#ba8e6e", "bad") !== null);
  assert.equal(deltaEHex("#ba8e6e", "not-a-color"), null);
  assert.equal(deltaEHex("zzz", "#ffffff"), null);
  assert.equal(deltaEHex("#ba8e6e", ""), null);
});

test("contrastRatio matches WCAG reference values", () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  assert.ok(Math.abs(contrastRatio(white, black) - 21) < 1e-6);
  assert.ok(Math.abs(contrastRatio(black, white) - 21) < 1e-6);
  assert.ok(Math.abs(contrastRatio(white, white) - 1) < 1e-6);
});

test("mixLab interpolates and clamps t", () => {
  const a = { L: 0, a: 0, b: 0 };
  const b = { L: 100, a: 20, b: -20 };
  assert.deepEqual(mixLab(a, b, 0), a);
  assert.deepEqual(mixLab(a, b, 1), b);
  assert.deepEqual(mixLab(a, b, 5), b);
  assert.deepEqual(mixLab(a, b, -5), a);
  const mid = mixLab(a, b, 0.5);
  assert.ok(Math.abs(mid.L - 50) < 1e-9);
});

test("adjustLightness preserves hue and returns valid hex", () => {
  const lighter = adjustLightness("#ba8e6e", 10)!;
  assert.ok(lighter.startsWith("#") && lighter.length === 7);
  const before = hexToLab("#ba8e6e")!;
  const after = hexToLab(lighter)!;
  assert.ok(after.L > before.L);
  assert.equal(adjustLightness("bogus", 10), null);
});

test("adjustChroma reduces saturation without changing hue much", () => {
  const muted = adjustChroma("#ff0000", 0.5)!;
  const original = labToLch(hexToLab("#ff0000")!);
  const reduced = labToLch(hexToLab(muted)!);
  assert.ok(reduced.C < original.C);
  assert.ok(Math.abs(hueDelta(reduced.h, original.h)) < 2);
});

test("isInSrgbGamut accepts representable colours and rejects impossible ones", () => {
  for (const hex of ["#ba8e6e", "#000000", "#ffffff", "#808080", "#ff0000"]) {
    assert.equal(isInSrgbGamut(hexToLab(hex)!), true, `${hex} should be in gamut`);
  }
  assert.equal(isInSrgbGamut({ L: 15, a: 90, b: -80 }), false);
  assert.equal(isInSrgbGamut({ L: 10, a: -95, b: 90 }), false);
});

test("withLightness actually achieves the requested lightness", () => {
  // The invariant the eye shadow generator depends on: the returned L* must be the
  // depth that survived the sRGB round-trip, not the depth that was requested.
  for (const hex of ["#ff5a36", "#ffc400", "#00b894", "#ff3d7f", "#0091ff", "#b0763f", "#2e2a26"]) {
    for (const target of [22, 30, 40, 50, 60, 70]) {
      const out = withLightness(hexToLab(hex)!, target);
      assert.ok(hexToLab(out.hex), `${hex}@${target}: produced invalid hex ${out.hex}`);
      assert.ok(
        Math.abs(out.lab.L - target) < 0.5,
        `${hex} at target L* ${target} actually produced L* ${out.lab.L.toFixed(2)}`,
      );
      assert.ok(isInSrgbGamut(out.lab), `${hex}@${target}: result is out of gamut`);
      // The reported Lab and the hex can differ by a fraction of an L* unit,
      // because the hex is quantised to 8 bits per channel. Anything larger would
      // mean the reported value was not the achieved one.
      assert.ok(
        Math.abs(hexToLab(out.hex)!.L - out.lab.L) < 0.3,
        `${hex}@${target}: reported L* ${out.lab.L.toFixed(2)} but the hex gives ${hexToLab(out.hex)!.L.toFixed(2)}`,
      );
    }
  }
});

test("withLightness keeps the hue of the source colour", () => {
  const srcHue = hexToLch("#ff5a36")!.h;
  const out = withLightness(hexToLab("#ff5a36")!, 45);
  const outHue = hexToLch(out.hex)!.h;
  assert.ok(hueDelta(srcHue, outHue) < 8, `hue moved from ${srcHue.toFixed(1)} to ${outHue.toFixed(1)}`);
});

test("withLightness is deterministic", () => {
  assert.equal(withLightness(hexToLab("#ffc400")!, 33).hex, withLightness(hexToLab("#ffc400")!, 33).hex);
});
