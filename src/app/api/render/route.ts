import { NextResponse } from "next/server";
import { analyze, resultFromMeasurement, type DataSource, type PipelineSuccess } from "@/lib/pipeline";
import { applyMakeup, isConfigured, type MakeupEffect, type TaskSource } from "@/lib/youcam";
import { getRecordedSample } from "@/lib/demo";

export const maxDuration = 120;

/**
 * Render a makeup look on a photo.
 *
 * Body: `{ lookId, imageUrl?, recordedSampleId?, measured?, quality?, source?, sourceRef? }`.
 *
 * The effects are always generated server-side from a measurement - the client
 * never posts effect payloads, so it cannot inject arbitrary malformed palettes.
 * It does supply the measurement itself (the server holds no session), so a
 * caller could choose which colours to be rendered; that is the same freedom a
 * user has by picking a different photo, and every colour still passes through
 * `classify`, `buildLooks` and `validateLook` before it reaches the engine.
 *
 * When `measured` is supplied the look is rebuilt from exactly those colours -
 * the same ones the browser is displaying - so the composited result matches the
 * swatches on screen. Without it the recorded sample is used, and the response
 * says so via `source`.
 *
 * Costs 1 unit per successful render. Failures are reported without a charge.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    lookId?: string;
    imageUrl?: string;
    recordedSampleId?: string;
    measured?: PipelineSuccess["measured"];
    quality?: PipelineSuccess["quality"];
    source?: DataSource;
    sourceRef?: { fileId?: string; fileUrl?: string };
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

  try {
    // Rebuild the look server-side from the measurement the browser is showing,
    // so the render matches the swatches on screen. Fall back to the recorded
    // sample only when the client sent no measurement.
    const result = body.measured?.skin_color
      ? resultFromMeasurement(
          body.measured,
          body.quality,
          body.source === "live" ? "live" : "recorded",
          body.sourceRef,
        )
      : await analyze({ recordedSampleId: body.recordedSampleId, preferRecorded: true });
    if (!result.ok) {
      return NextResponse.json(
        { ...result, code: "NoProfile", guidance: "Analyse a photo first, then render a look." },
        { status: 400 },
      );
    }

    // Composite onto the photo that was actually measured. An uploaded photo is
    // reused by its YouCam file id (no re-upload); a URL photo by its URL. Only
    // when the client sent neither do we fall back to the recorded sample.
    const sample = getRecordedSample(body.recordedSampleId);
    const source: TaskSource =
      body.sourceRef?.fileId
        ? { fileId: body.sourceRef.fileId }
        : body.imageUrl || body.sourceRef?.fileUrl
          ? { fileUrl: (body.imageUrl ?? body.sourceRef!.fileUrl) as string }
          : { fileUrl: sample.imageUrl };

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
      source,
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

    return NextResponse.json({
      ok: true,
      imageUrl: outcome.imageUrl,
      lookId: look.id,
      lookName: look.name,
      source: result.source,
    });
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
