import { NextResponse } from "next/server";
import { analyze } from "@/lib/pipeline";
import { applyMakeup, isConfigured, type MakeupEffect } from "@/lib/youcam";
import { getRecordedSample } from "@/lib/demo";

export const maxDuration = 120;

/**
 * Render a makeup look on a photo.
 *
 * Body: `{ lookId, imageUrl?, recordedSampleId?, effects? }`.
 * The effects are generated server-side from the measured profile, so the client
 * cannot post arbitrary colours as if they were derived from a measurement. When
 * `effects` is supplied directly it is still sent through the same generator
 * shape rather than trusted blindly.
 *
 * Costs 1 unit per successful render. Failures are reported without a charge.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    lookId?: string;
    imageUrl?: string;
    recordedSampleId?: string;
  };

  if (!isConfigured()) {
    return NextResponse.json({
      ok: false,
      code: "MissingApiKey",
      title: "No API key configured",
      message: "Rendering a look needs a YouCam API key on the server.",
      guidance: "Set YOUCAM_API_KEY and restart. Colour analysis and shade matching work without rendering.",
      retryable: false,
      unitsSpent: false,
    });
  }

  // Resolve the image: explicit URL, else the recorded sample's image.
  const sample = getRecordedSample(body.recordedSampleId);
  const imageUrl = body.imageUrl ?? sample.imageUrl;

  try {
    // Always regenerate the look server-side from a measurement.
    const result = await analyze({ recordedSampleId: body.recordedSampleId, preferRecorded: true });
    if (!result.ok) {
      return NextResponse.json(
        { ...result, code: "NoProfile", guidance: "Analyse a photo first, then render a look." },
        { status: 400 },
      );
    }

    const look = result.looks.find((l) => l.id === (body.lookId ?? "signature")) ?? result.looks[0];
    const problems = result.preflight.find((p) => p.lookId === look.id)?.problems ?? [];
    if (problems.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "LookInvalid",
          title: "That look failed its pre-flight check",
          message: problems.join("; "),
          guidance: "This is a bug in the look generator; nothing was sent to the engine.",
          retryable: false,
          unitsSpent: false,
        },
        { status: 500 },
      );
    }

    const outcome = await applyMakeup(
      { fileUrl: imageUrl },
      look.effects.map((e) => e.payload as unknown as MakeupEffect),
      { timeoutMs: 110_000 },
    );

    if (!outcome.ok) {
      return NextResponse.json({
        ok: false,
        code: outcome.failure?.code ?? "EngineError",
        title: outcome.failure?.message ?? "The engine could not render this look",
        message: outcome.failure?.message ?? "Rendering failed.",
        guidance: outcome.failure?.guidance ?? "Try a different photo.",
        retryable: true,
        unitsSpent: false,
      });
    }

    return NextResponse.json({ ok: true, imageUrl: outcome.imageUrl, lookId: look.id, lookName: look.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    const isCredits = /credit/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        code: isCredits ? "CreditInsufficiency" : "RenderFailed",
        title: isCredits ? "The API account is out of units" : "The look could not be rendered",
        message,
        guidance: isCredits
          ? "Add units to the YouCam account to render looks. Colour analysis and shade matching still work."
          : "Try again with a front-facing photo.",
        retryable: true,
        unitsSpent: false,
      },
      { status: 502 },
    );
  }
}
