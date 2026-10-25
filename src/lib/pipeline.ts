/**
 * The analysis pipeline.
 *
 * One place that turns "an image" into a full consultation result, so the route
 * handlers stay thin and the behaviour is testable without a network.
 *
 * The important design rule: the result always carries a `source` of `"live"` or
 * `"recorded"`. Nothing downstream may present recorded data as a live
 * measurement, and the UI renders that distinction as a visible badge.
 */

import { classify, type ColorProfile } from "./season.ts";
import { buildLooks, toMakeupRequest, validateLook, type Look } from "./looks.ts";
import { analyzeSkinTone, isConfigured, YouCamError, type SkinToneOutcome } from "./youcam.ts";
import { getRecordedSample } from "./demo.ts";

export type DataSource = "live" | "recorded";

export interface PipelineSuccess {
  ok: true;
  source: DataSource;
  /** Human-readable explanation of where the numbers came from. */
  provenance: string;
  measured: {
    skin_color?: string;
    lip_color?: string;
    eye_color?: string;
    eyebrow_color?: string;
    hair_color?: string;
    eye_color_name?: string;
    hair_color_name?: string;
  };
  quality: {
    has_face?: boolean;
    area?: string | null;
    frontal?: string | null;
    lighting?: string | null;
    faceangle?: string | null;
  };
  profile: ColorProfile;
  looks: Look[];
  /**
   * The input the measurement came from. A render reuses this so the composited
   * image is the same photo that was measured - reusing the uploaded file id
   * rather than re-uploading, and never substituting another person's photo.
   */
  sourceRef: { fileId?: string; fileUrl?: string };
  /** Ready-to-send makeup payloads, one per look. */
  makeupRequests: Array<{ lookId: string; lookName: string; body: ReturnType<typeof toMakeupRequest> }>;
  /** Structural problems found before sending anything to the engine. */
  preflight: Array<{ lookId: string; problems: string[] }>;
  warnings: string[];
}

export interface PipelineFailure {
  ok: false;
  source: DataSource;
  /** Short machine code, e.g. CreditInsufficiency. */
  code: string;
  title: string;
  message: string;
  guidance: string;
  /** True when retrying later could work. */
  retryable: boolean;
  /** False when the request never reached the engine (so nothing was billed). */
  unitsSpent: boolean;
}

export type PipelineResult = PipelineSuccess | PipelineFailure;

export interface AnalyzeOptions {
  /** Raw image bytes for a live call. */
  bytes?: Uint8Array;
  contentType?: string;
  fileName?: string;
  /** Public image URL for a live call. */
  imageUrl?: string;
  /** Use a recorded response instead of calling the API. */
  recordedSampleId?: string;
  /** Force recorded mode even if a key exists. */
  preferRecorded?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Explain a YouCam failure in terms a shopper can act on. */
function failureFromYouCam(err: YouCamError): PipelineFailure {
  if (err.code === "CreditInsufficiency") {
    return {
      ok: false,
      source: "live",
      code: err.code,
      title: "The API account is out of units",
      message:
        "YouCam rejected the request before running it because the API account has no units left. Nothing was measured and nothing was charged.",
      guidance:
        "Add units to the YouCam account, then run the analysis again. You can still explore the app using the recorded sample, which is clearly labelled as recorded.",
      retryable: true,
      unitsSpent: false,
    };
  }
  if (err.code === "MissingApiKey") {
    return {
      ok: false,
      source: "live",
      code: err.code,
      title: "No API key configured",
      message: "The server has no YOUCAM_API_KEY set, so it cannot call the YouCam API.",
      guidance:
        "Set YOUCAM_API_KEY in the environment (see .env.example) and restart the server. The recorded sample works without a key.",
      retryable: false,
      unitsSpent: false,
    };
  }
  if (err.code === "InvalidApiKey" || err.status === 401 || err.status === 403) {
    return {
      ok: false,
      source: "live",
      code: err.code,
      title: "The YouCam API rejected the server's API key",
      message:
        "The API key the server sent was not accepted, so no measurement was run and nothing was charged.",
      guidance:
        "Verify YOUCAM_API_KEY on the server holds a current key for this YouCam environment (see .env.example), then restart. Changing the photo will not fix a rejected key. The recorded sample works without a key.",
      retryable: false,
      unitsSpent: false,
    };
  }
  return {
    ok: false,
    source: "live",
    code: err.code,
    title: err.retryable ? "The YouCam API is temporarily unavailable" : "The YouCam API rejected the request",
    message: err.message,
    guidance: err.retryable
      ? "Wait a moment and try again. If it keeps failing, check the YouCam API status."
      : "Check the image and the request, then try again.",
    retryable: err.retryable,
    unitsSpent: false,
  };
}

/** Turn a successful measurement (live or recorded) into a full result. */
export function buildResult(
  source: DataSource,
  provenance: string,
  outcome: SkinToneOutcome,
  sourceRef: { fileId?: string; fileUrl?: string } = {},
): PipelineResult {
  const colors = outcome.results?.color ?? {};
  const quality = outcome.results?.face_quality ?? {};

  if (!colors.skin_color) {
    return {
      ok: false,
      source,
      code: "NoSkinColour",
      title: "No skin colour was returned",
      message: "The API completed but did not return a skin colour, so there is nothing to classify.",
      guidance: "Try a clearer, front-facing photo in even light.",
      retryable: true,
      unitsSpent: source === "live",
    };
  }

  let profile: ColorProfile;
  try {
    profile = classify({ colors, quality });
  } catch (err) {
    return {
      ok: false,
      source,
      code: "ClassificationFailed",
      title: "The measured colours could not be classified",
      message: err instanceof Error ? err.message : "Unknown classification error.",
      guidance: "This is a bug in the analysis step rather than a problem with your photo.",
      retryable: false,
      unitsSpent: source === "live",
    };
  }

  const looks = buildLooks(profile);
  const makeupRequests = looks.map((look) => ({
    lookId: look.id,
    lookName: look.name,
    body: toMakeupRequest(look),
  }));
  const preflight = looks
    .map((look) => ({ lookId: look.id, problems: validateLook(look) }))
    .filter((p) => p.problems.length > 0);

  const warnings: string[] = [...profile.caveats];
  if (preflight.length > 0) {
    warnings.push(
      "Some generated looks failed the pre-flight check and were withheld rather than sent to the engine.",
    );
  }

  return {
    ok: true,
    source,
    provenance,
    measured: {
      skin_color: colors.skin_color,
      lip_color: colors.lip_color,
      eye_color: colors.eye_color,
      eyebrow_color: colors.eyebrow_color,
      hair_color: colors.hair_color,
      eye_color_name: colors.eye_color_name,
      hair_color_name: colors.hair_color_name,
    },
    quality: {
      has_face: quality.has_face,
      area: quality.area ?? null,
      frontal: quality.frontal ?? null,
      lighting: quality.lighting ?? null,
      faceangle: quality.faceangle ?? null,
    },
    profile,
    looks,
    sourceRef,
    makeupRequests,
    preflight,
    warnings,
  };
}

/** Build a result from the recorded fixture, clearly labelled. */
export function recordedResult(sampleId?: string): PipelineResult {
  const sample = getRecordedSample(sampleId);
  return buildResult(
    "recorded",
    `Recorded response, captured ${sample.capturedAt} from ${sample.endpoint}. This is real API output that is replayed, not a new measurement.`,
    { ok: true, results: sample.response.results },
  );
}

/**
 * Rebuild a result from a measurement the browser already holds.
 *
 * The render route uses this so the composited look matches the colours on
 * screen. Without it the route had no measurement to work from and fell back to
 * the recorded sample, so a user measured as, say, True Autumn would see a look
 * computed for the fixture's Bright Spring. Classification is deterministic, so
 * rebuilding from the same colours yields exactly the looks the user is looking
 * at.
 *
 * `source` is carried through rather than assumed: a rebuild of recorded colours
 * stays labelled recorded.
 */
export function resultFromMeasurement(
  measured: PipelineSuccess["measured"],
  quality: PipelineSuccess["quality"] = {},
  source: DataSource = "live",
  sourceRef: { fileId?: string; fileUrl?: string } = {},
): PipelineResult {
  return buildResult(
    source,
    source === "live"
      ? "Rebuilt from the live measurement shown in the browser."
      : "Rebuilt from the recorded measurement shown in the browser.",
    {
      ok: true,
      results: {
        color: { ...measured },
        face_quality: {
          has_face: quality.has_face,
          area: quality.area ?? undefined,
          frontal: quality.frontal ?? undefined,
          lighting: quality.lighting ?? undefined,
          faceangle: quality.faceangle ?? undefined,
        },
      },
    },
    sourceRef,
  );
}

/**
 * Analyse an image.
 *
 * Order of decisions, each one explicit so the caller can tell what happened:
 *  1. If `preferRecorded`, replay the recorded response (no network, no units).
 *  2. If there is no key, fall back to recorded and say so.
 *  3. Otherwise call the API. On a credit or engine failure, report it; the
 *     caller may then choose to show the recorded sample.
 */
export async function analyze(opts: AnalyzeOptions = {}): Promise<PipelineResult> {
  if (opts.preferRecorded) return recordedResult(opts.recordedSampleId);

  if (!isConfigured()) {
    const recorded = recordedResult(opts.recordedSampleId);
    if (recorded.ok) {
      recorded.warnings = [
        "No API key is configured, so this is the recorded sample rather than a new measurement.",
        ...recorded.warnings,
      ];
    }
    return recorded;
  }

  if (!opts.bytes && !opts.imageUrl) {
    return {
      ok: false,
      source: "live",
      code: "NoImage",
      title: "No image supplied",
      message: "Provide an image file or a public image URL to analyse.",
      guidance: "Choose a photo, or use the recorded sample to explore the app.",
      retryable: false,
      unitsSpent: false,
    };
  }

  try {
    const source = opts.imageUrl ? { fileUrl: opts.imageUrl } : { fileId: await uploadFor(opts) };
    const outcome = await analyzeSkinTone(source, {
      timeoutMs: opts.timeoutMs ?? 120_000,
      signal: opts.signal,
      faceAngleStrictness: "high",
    });

    if (!outcome.ok) {
      return {
        ok: false,
        source: "live",
        code: outcome.failure?.code ?? "EngineError",
        title: outcome.failure?.message ?? "The engine could not process this image",
        message: outcome.failure?.message ?? "The YouCam engine rejected this image.",
        guidance: outcome.failure?.guidance ?? "Try a clearer, front-facing photo.",
        retryable: true,
        unitsSpent: false,
      };
    }

    return buildResult(
      "live",
      "Measured just now by the YouCam skin tone analysis API.",
      outcome,
      source,
    );
  } catch (err) {
    if (err instanceof YouCamError) return failureFromYouCam(err);
    return {
      ok: false,
      source: "live",
      code: "UnexpectedError",
      title: "Something went wrong",
      message: err instanceof Error ? err.message : "Unknown error.",
      guidance: "Try again, or use the recorded sample to explore the app.",
      retryable: true,
      unitsSpent: false,
    };
  }
}

/** Upload bytes and return the YouCam file id. Kept separate so `analyze` stays readable. */
async function uploadFor(opts: AnalyzeOptions): Promise<string> {
  const { uploadImage } = await import("./youcam.ts");
  if (!opts.bytes) throw new YouCamError("No image bytes to upload.", { code: "NoImage", status: 400 });
  return uploadImage(opts.bytes, opts.contentType ?? "image/jpeg", opts.fileName ?? "selfie.jpg");
}
