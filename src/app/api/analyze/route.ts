import { NextResponse } from "next/server";
import { analyze, type PipelineResult } from "@/lib/pipeline";
import { isConfigured, uploadImage } from "@/lib/youcam";
import { MAX_BODY_BYTES, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, fileSizeError } from "@/lib/upload-limit";
import { checkAccess, guardRequest, type GuardFailure } from "@/lib/security/budget";
import { analyzeBodySchema } from "@/lib/security/schemas";
import {
  BodyTooLargeError,
  MalformedBodyError,
  declaredTooLarge,
  readCappedFormData,
  readCappedJson,
} from "@/lib/security/request-body";
import { ImageSourceError, fetchRemoteImage } from "@/lib/security/image-fetch";
import { issueTicket, ticketSigningConfigured } from "@/lib/security/render-ticket";
import { logServerError } from "@/lib/errors";

export const maxDuration = 120;

/** Units the skin-tone analysis costs on success. */
const ANALYZE_COST = 20;

/**
 * Wall-clock budget for the whole live analysis path. Must stay strictly below
 * `maxDuration` (120s) so our own deadline fires before the platform kills the
 * function, giving the user an actionable error instead of a platform timeout.
 */
const ANALYZE_TOTAL_BUDGET_MS = 100_000;

function failureResponse(f: GuardFailure) {
  return NextResponse.json(
    {
      ok: false,
      code: f.code,
      title: f.title,
      message: f.message,
      guidance: f.guidance,
      retryable: f.retryable,
      unitsSpent: false,
      source: "live",
    },
    { status: f.status },
  );
}

/** The response for a request whose body is too large, from either guard. */
function tooLargeResponse(bytes: number) {
  return NextResponse.json(
    {
      ok: false,
      code: "FileTooLarge",
      title: "That image is too large",
      message: fileSizeError(bytes) ?? `That image is over the ${MAX_UPLOAD_MB} MB limit.`,
      guidance: "Choose a smaller photo, or compress this one and try again.",
      retryable: false,
      unitsSpent: false,
      source: "live",
    },
    { status: 413 },
  );
}

function badRequest(code: string, title: string, message: string, guidance: string) {
  return NextResponse.json(
    { ok: false, code, title, message, guidance, retryable: false, unitsSpent: false, source: "live" },
    { status: 400 },
  );
}

/**
 * Seal the measurement and its true photo reference into a signed ticket so the
 * render route can trust them without re-deriving anything from the client.
 * Returns null when signing is not configured or there is nothing to seal.
 */
function ticketFor(result: PipelineResult): string | null {
  if (!result.ok || !ticketSigningConfigured()) return null;
  return issueTicket({
    fileId: result.sourceRef.fileId,
    fileUrl: result.sourceRef.fileUrl,
    measured: result.measured as unknown as Record<string, string | undefined>,
    quality: result.quality as unknown as Record<string, string | boolean | null | undefined>,
    source: result.source,
    expiresAt: Date.now() + 30 * 60_000,
  });
}

/** Attach a render ticket to a successful result, when signing is available. */
function withTicket(result: PipelineResult): PipelineResult & { ticket: string | null } {
  if (!result.ok) return result as PipelineResult & { ticket: string | null };
  return { ...result, ticket: ticketFor(result) };
}

/**
 * Analyse a selfie.
 *
 * Accepts multipart form data with a `file` field, or JSON with `{ imageUrl }`
 * or `{ recordedSampleId }`. The response always states whether the numbers are
 * live or recorded, so the client cannot present a replayed fixture as a fresh
 * measurement. On success it also carries a signed render ticket, which is how
 * the render route learns the measurement and photo without trusting the client.
 *
 * The body is size-checked before parsing and streamed with a hard cap, so an
 * oversized request is refused rather than buffered. Live analysis costs 20
 * units and is guarded by access control and a distributed daily budget.
 */
export async function POST(request: Request) {
  // Access control first: no Redis, no body read, no cost.
  const access = checkAccess(request);
  if (access) return failureResponse(access);

  const contentType = request.headers.get("content-type") ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  try {
    // Cheap pre-check before reading a single byte.
    if (declaredTooLarge(request, MAX_BODY_BYTES)) {
      return tooLargeResponse(Number(request.headers.get("content-length")));
    }

    if (isMultipart) {
      const form = await readCappedFormData(request, MAX_BODY_BYTES);
      const file = form.get("file");
      const recorded = form.get("recordedSampleId");

      if (recorded && typeof recorded === "string" && file === null) {
        return NextResponse.json(withTicket(await analyze({ recordedSampleId: recorded, preferRecorded: true })));
      }
      if (!(file instanceof File)) {
        return badRequest(
          "NoImage",
          "No image supplied",
          "Attach an image file.",
          "Choose a JPEG or PNG photo of one face.",
        );
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return tooLargeResponse(file.size);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const guard = await guardRequest({ request, cost: ANALYZE_COST, willSpend: true });
      if (!guard.ok) return failureResponse(guard);
      const result = await analyze({ bytes, contentType: file.type || "image/jpeg", fileName: file.name || "selfie.jpg" });
      await guard.settle(result.ok);
      return NextResponse.json(withTicket(result));
    }

    const parsed = analyzeBodySchema.safeParse(await readCappedJson(request, MAX_BODY_BYTES));
    if (!parsed.success) {
      return badRequest(
        "BadRequest",
        "That request was not understood",
        "The request body was malformed.",
        "Reload the app and try again.",
      );
    }
    const body = parsed.data;

    // Recorded sample: free, never fails closed, never touches the API.
    if (body.preferRecorded || (!body.imageUrl && body.recordedSampleId)) {
      return NextResponse.json(withTicket(await analyze({ recordedSampleId: body.recordedSampleId, preferRecorded: true })));
    }

    if (body.imageUrl) {
      const guard = await guardRequest({ request, cost: ANALYZE_COST, willSpend: true });
      if (!guard.ok) return failureResponse(guard);
      let result: PipelineResult;
      try {
        // One wall-clock budget for the whole live URL path (fetch + upload +
        // analysis) so the stages cannot sum past the route's `maxDuration`.
        const deadline = Date.now() + ANALYZE_TOTAL_BUDGET_MS;
        const remaining = () => Math.max(5_000, deadline - Date.now());
        // Fetch and validate the image ourselves, then upload it, so the engine
        // only ever receives a YouCam file id and never a client-supplied URL.
        const image = await fetchRemoteImage(body.imageUrl, {
          maxBytes: MAX_UPLOAD_BYTES,
          timeoutMs: Math.min(15_000, remaining()),
        });
        const fileId = await uploadImage(image.bytes, image.contentType, "remote-image", {
          timeoutMs: Math.min(45_000, Math.floor(remaining() / 2)),
        });
        result = await analyze({
          contentType: image.contentType,
          fileName: "remote-image.jpg",
          preUploadedFileId: fileId,
          timeoutMs: remaining(),
        });
      } catch (err) {
        // A refused image source is a client error, not a server fault: answer
        // 400 and never let the upstream call happen (no units were spent).
        await guard.settle(false);
        const isSourceError = err instanceof ImageSourceError;
        if (!isSourceError) logServerError("analyze:url", err);
        const code = isSourceError ? err.code : "ImageUnavailable";
        return NextResponse.json(
          {
            ok: false,
            code,
            title: "That image URL could not be used",
            message: isSourceError ? err.message : "The image could not be fetched.",
            guidance: "Use a direct link to a JPEG or PNG on a public host, or upload the photo instead.",
            retryable: false,
            unitsSpent: false,
            source: "live",
          },
          { status: 400 },
        );
      }
      await guard.settle(result.ok);
      return NextResponse.json(withTicket(result));
    }

    // No image at all: replay the recorded sample rather than erroring, so the
    // app is explorable out of the box. This is free and clearly labelled.
    return NextResponse.json(withTicket(await analyze({ recordedSampleId: body.recordedSampleId, preferRecorded: true })));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return tooLargeResponse(err.bytes);
    if (err instanceof MalformedBodyError) {
      return badRequest(
        "MalformedBody",
        "That request could not be read",
        err.message,
        "Reload the app and try again.",
      );
    }
    logServerError("analyze", err);
    return NextResponse.json(
      {
        ok: false,
        code: "ServerError",
        title: "The analysis could not be started",
        message: "The analysis could not be started. Try again.",
        guidance: "Try again.",
        retryable: true,
        unitsSpent: false,
        source: "live",
      },
      { status: 500 },
    );
  }
}

/** Health and configuration probe. Never reveals the key itself. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    apiConfigured: isConfigured(),
    endpoint: "/s2s/v2.0/task/skin-tone-analysis",
  });
}
