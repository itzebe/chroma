import { NextResponse } from "next/server";
import { analyze, resultFromMeasurement, type DataSource, type PipelineSuccess } from "@/lib/pipeline";
import { applyMakeup, isConfigured, YouCamError, type MakeupEffect, type TaskSource } from "@/lib/youcam";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limit";
import { checkAccess, guardRequest, type GuardFailure } from "@/lib/security/budget";
import { renderBodySchema } from "@/lib/security/schemas";
import { BodyTooLargeError, MalformedBodyError, readCappedJson } from "@/lib/security/request-body";
import { verifyTicket } from "@/lib/security/render-ticket";
import { logServerError } from "@/lib/errors";

export const maxDuration = 120;

/** Units a successful makeup render costs. */
const RENDER_COST = 1;
/** Must stay strictly below maxDuration so the platform never kills the function. */
const UPSTREAM_BUDGET_MS = 100_000;

function failureResponse(f: GuardFailure) {
  return NextResponse.json(
    { ok: false, code: f.code, title: f.title, message: f.message, guidance: f.guidance, retryable: f.retryable, unitsSpent: false },
    { status: f.status },
  );
}

function badRequest(code: string, title: string, message: string, guidance: string) {
  return NextResponse.json({ ok: false, code, title, message, guidance, retryable: false, unitsSpent: false }, { status: 400 });
}

/**
 * Render a makeup look on a photo.
 *
 * Body: `{ lookId, ticket?, recordedSampleId? }`.
 *
 * The photo and the measurement are NOT taken from the request body. They come
 * from a signed ticket the analyse route issued, so:
 *  - the colours are exactly the ones the browser is displaying,
 *  - the photo is the one that was actually measured,
 *  - `source` is derived from server state and cannot be forged by a client.
 *
 * Without a ticket the route only serves the recorded demonstration sample,
 * clearly labelled. It never composites makeup onto a stock face while the user
 * believes they are looking at their own photo, and it never calls the paid API
 * for a request that has no real photo.
 *
 * Costs 1 unit per successful render. Failures are reported without a charge.
 */
export async function POST(request: Request) {
  const access = checkAccess(request);
  if (access) return failureResponse(access);

  let body: ReturnType<typeof renderBodySchema.parse>;
  try {
    const parsed = renderBodySchema.safeParse(await readCappedJson(request, MAX_UPLOAD_BYTES));
    if (!parsed.success) {
      return badRequest("BadRequest", "That request was not understood", "The render request was malformed.", "Reload the app and try again.");
    }
    body = parsed.data;
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return badRequest("BodyTooLarge", "That request was too large", "The render request body was too large.", "Reload the app and try again.");
    }
    if (err instanceof MalformedBodyError) {
      return badRequest("MalformedBody", "That request could not be read", "The render request body could not be parsed.", "Reload the app and try again.");
    }
    throw err;
  }

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

  const ticket = verifyTicket(body.ticket);

  // A signed ticket describes a real measurement and its real photo.
  let result: PipelineSuccess;
  let source: TaskSource;
  if (ticket) {
    const rebuilt = resultFromMeasurement(ticket.measured as PipelineSuccess["measured"], ticket.quality as PipelineSuccess["quality"], ticket.source, {
      fileId: ticket.fileId,
      fileUrl: ticket.fileUrl,
    });
    if (!rebuilt.ok) {
      return NextResponse.json({ ...rebuilt, code: "NoProfile", guidance: "Analyse a photo first, then render a look." }, { status: 400 });
    }
    result = rebuilt;
    // The photo must be the one the measurement came from.
    if (ticket.fileId) source = { fileId: ticket.fileId };
    else if (ticket.fileUrl) source = { fileUrl: ticket.fileUrl };
    else {
      return badRequest("NoPhoto", "No photo to render onto", "The measurement is not linked to a photo.", "Analyse a photo, then render.");
    }
  } else if (body.ticket) {
    // A ticket was supplied but did not verify: it was forged, tampered with, or
    // has expired. Refuse rather than silently rendering onto the wrong face.
    return NextResponse.json(
      {
        ok: false,
        code: "InvalidTicket",
        title: "This render request has expired",
        message: "The link between your measurement and this render is no longer valid.",
        guidance: "Analyse your photo again, then render the look.",
        retryable: true,
        unitsSpent: false,
      },
      { status: 400 },
    );
  } else if (body.recordedSampleId) {
    // Explicit recorded-demo render with no ticket (ticket signing is optional).
    // This path is deliberately narrow: it can only ever composite onto the
    // recorded sample's OWN photo, and it is always labelled recorded. It cannot
    // be used to render onto a client-supplied URL or an arbitrary face, which
    // was the original wrong-face defect.
    const recorded = await analyze({ recordedSampleId: body.recordedSampleId, preferRecorded: true });
    if (!recorded.ok) {
      return NextResponse.json({ ...recorded, code: "UnknownSample", guidance: "Load the recorded analysis from the interface." }, { status: 400 });
    }
    result = recorded;
    source = recorded.sourceRef.fileUrl ? { fileUrl: recorded.sourceRef.fileUrl } : { fileId: recorded.sourceRef.fileId! };
  } else {
    // No ticket and no recorded sample. A live render must be tied to a
    // measurement and its own photo, so there is nothing trustworthy to
    // composite onto. Refuse rather than borrowing the recorded sample's face
    // for a request that did not ask for it, and never call the paid engine.
    return NextResponse.json(
      {
        ok: false,
        code: "MissingTicket",
        title: "Analyse a photo before rendering",
        message: "Rendering needs the measurement and photo that the analysis produced.",
        guidance: "Load the recorded analysis or measure your photo, then render a look.",
        retryable: false,
        unitsSpent: false,
      },
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

  const guard = await guardRequest({ request, cost: RENDER_COST, willSpend: true });
  if (!guard.ok) return failureResponse(guard);

  try {
    const outcome = await applyMakeup(
      source,
      look.effects.map((e) => e.payload as unknown as MakeupEffect),
      { timeoutMs: UPSTREAM_BUDGET_MS },
    );

    if (!outcome.ok) {
      await guard.settle(false);
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

    await guard.settle(true);
    return NextResponse.json({
      ok: true,
      imageUrl: outcome.imageUrl,
      lookId: look.id,
      lookName: look.name,
      source: result.source as DataSource,
    });
  } catch (err) {
    await guard.settle(false);
    const isCredits = err instanceof YouCamError && /credit|insufficient/i.test(err.message);
    const isAuth = err instanceof YouCamError ? err.code === "InvalidApiKey" || err.status === 401 || err.status === 403 : false;
    logServerError("render", err);
    const code = isCredits ? "CreditInsufficiency" : isAuth ? "InvalidApiKey" : "RenderFailed";
    const title = isCredits
      ? "The API account is out of units"
      : isAuth
        ? "The YouCam API rejected the server's API key"
        : "The look could not be rendered";
    const guidance = isCredits
      ? "Add units to the YouCam account to render looks. Colour analysis and shade matching still work."
      : isAuth
        ? "Verify YOUCAM_API_KEY on the server holds a current key for this YouCam environment, then restart. A different photo will not fix a rejected key."
        : "Try again with a front-facing photo.";
    return NextResponse.json(
      { ok: false, code, title, message: "The look could not be rendered.", guidance, retryable: !isAuth, unitsSpent: false },
      { status: isAuth ? 401 : 502 },
    );
  }
}
