/**
 * Render-source tests.
 *
 * The render route composites a look onto a photo. Two defects are pinned here,
 * both of which produced a visually plausible but wrong result:
 *
 *  1. The route rebuilt the look from the recorded fixture rather than the
 *     measurement the browser was showing, so a user measured as one season saw
 *     makeup computed for another.
 *  2. With no measurement and no URL it fell back to the recorded sample's
 *     photo, compositing makeup onto a different person's face.
 *
 * `resultFromMeasurement` is the seam that fixes both: it rebuilds from the
 * supplied colours and carries the true source reference.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/lib/season.ts";
import { buildResult, recordedResult, resultFromMeasurement } from "../src/lib/pipeline.ts";

const measured = {
  skin_color: "#bc9d88",
  lip_color: "#be8782",
  eye_color: "#342724",
  eyebrow_color: "#805d47",
  hair_color: "#B56637",
  eye_color_name: "Brown",
  hair_color_name: "Auburn",
};

const quality = { has_face: true, area: "good", frontal: "good", lighting: "good", faceangle: "good" };

test("resultFromMeasurement rebuilds looks from the supplied colours, not the fixture", () => {
  const rebuilt = resultFromMeasurement(measured, quality, "live");
  assert.equal(rebuilt.ok, true);
  if (!rebuilt.ok) return;

  // Same season as classifying the raw colours directly.
  const expected = classify({
    colors: {
      skin_color: measured.skin_color,
      lip_color: measured.lip_color,
      eye_color: measured.eye_color,
      eyebrow_color: measured.eyebrow_color,
      hair_color: measured.hair_color,
    },
    quality,
  });
  assert.equal(rebuilt.profile.season.id, expected.season.id);

  // The recorded fixture is a different season, so a fixture rebuild would fail
  // this assertion. This is the regression the render route shipped with.
  const fixture = recordedResult();
  assert.equal(fixture.ok, true);
  if (!fixture.ok) return;
  assert.notEqual(
    rebuilt.profile.season.id,
    fixture.profile.season.id,
    "live measurement must not collapse onto the recorded fixture's season",
  );

  const lip = (look: (typeof rebuilt.looks)[number]) =>
    (look.effects.find((e) => e.category === "lip_color")!.payload as { palettes: { color: string }[] })
      .palettes[0].color;
  const rebuiltEvening = rebuilt.looks.find((l) => l.id === "evening")!;
  const fixtureEvening = fixture.looks.find((l) => l.id === "evening")!;
  assert.notEqual(lip(rebuiltEvening), lip(fixtureEvening));
});

test("resultFromMeasurement labels the rebuild with its true source", () => {
  const live = resultFromMeasurement(measured, quality, "live");
  assert.equal(live.source, "live");
  assert.match(live.ok ? live.provenance : "", /live/i);

  const recorded = resultFromMeasurement(measured, quality, "recorded");
  assert.equal(recorded.source, "recorded", "a rebuild of recorded colours must stay labelled recorded");
  assert.match(recorded.ok ? recorded.provenance : "", /recorded/i);
});

test("resultFromMeasurement carries the source reference so the render reuses the measured photo", () => {
  const withFile = resultFromMeasurement(measured, quality, "live", { fileId: "file-abc" });
  assert.equal(withFile.ok, true);
  if (withFile.ok) assert.equal(withFile.sourceRef.fileId, "file-abc");

  const withUrl = resultFromMeasurement(measured, quality, "live", { fileUrl: "https://example.test/me.jpg" });
  assert.equal(withUrl.ok, true);
  if (withUrl.ok) assert.equal(withUrl.sourceRef.fileUrl, "https://example.test/me.jpg");
});

test("buildResult records the source reference on a live measurement", () => {
  const result = buildResult(
    "live",
    "Measured just now.",
    { ok: true, results: { color: { ...measured }, face_quality: { ...quality } } },
    { fileId: "file-xyz" },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.sourceRef.fileId, "file-xyz");
});

test("the rebuilt looks still pass the engine pre-flight check", () => {
  const rebuilt = resultFromMeasurement(measured, quality, "live");
  assert.equal(rebuilt.ok, true);
  if (!rebuilt.ok) return;
  assert.deepEqual(rebuilt.preflight, [], "rebuilt looks must remain shippable to the makeup engine");
});
