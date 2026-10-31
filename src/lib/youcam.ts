/**
 * YouCam API client (server-only).
 *
 * The API key is read from `YOUCAM_API_KEY` at call time and never logged,
 * echoed in errors, or returned to the browser. This module must only be
 * imported from server code (route handlers / server actions).
 *
 * API shape notes that drove this design:
 *  - Tasks are asynchronous: POST returns a `task_id`, then GET polls until
 *    `task_status` is `success` or `error`.
 *  - Engine errors (bad photo, no face, wrong angle) come back as HTTP 200 with
 *    `task_status: "error"`, NOT as an HTTP error. They consume no units, so we
 *    surface them as structured, actionable failures rather than exceptions.
 *  - `src_file_id` (uploaded) and `src_file_url` (public) are interchangeable.
 */

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "./upload-limit.ts";

export type TaskPath = "/s2s/v2.0/task/skin-tone-analysis" | "/s2s/v2.0/task/makeup-vto";

const DEFAULT_BASE = "https://yce-api-01.makeupar.com";

export class YouCamError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  /** Units are not charged for engine errors; surfaced so the UI can say so. */
  readonly chargedUnits: boolean;

  constructor(
    message: string,
    opts: { code: string; status: number; retryable?: boolean; chargedUnits?: boolean },
  ) {
    super(message);
    this.name = "YouCamError";
    this.code = opts.code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.chargedUnits = opts.chargedUnits ?? false;
  }
}

function baseUrl(): string {
  return (process.env.YOUCAM_API_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

function apiKey(): string {
  const key = process.env.YOUCAM_API_KEY;
  if (!key) {
    throw new YouCamError(
      "The YouCam API key is not configured on the server. Set YOUCAM_API_KEY in the environment.",
      { code: "MissingApiKey", status: 500 },
    );
  }
  return key;
}

/** True when the server has a key, without ever revealing it. */
export function isConfigured(): boolean {
  return Boolean(process.env.YOUCAM_API_KEY);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  /** Extra headers, used by the upload step. */
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body (e.g. an HTML error page from a proxy).
      if (!res.ok) {
        throw new YouCamError("The YouCam API returned an unreadable response.", {
          code: "UnreadableResponse",
          status: res.status,
          retryable: res.status >= 500,
        });
      }
      throw new YouCamError("The YouCam API returned a non-JSON success response.", {
        code: "UnreadableResponse",
        status: res.status,
      });
    }

    if (!res.ok) {
      const body = (parsed ?? {}) as { error?: string; error_code?: string };
      throw new YouCamError(body.error || `YouCam API request failed (${res.status}).`, {
        code: body.error_code || `HTTP_${res.status}`,
        status: res.status,
        retryable: res.status >= 500 || res.status === 429,
      });
    }

    return parsed as T;
  } catch (err) {
    if (err instanceof YouCamError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new YouCamError("The YouCam API request timed out.", {
        code: "Timeout",
        status: 504,
        retryable: true,
      });
    }
    throw new YouCamError(
      `Could not reach the YouCam API: ${err instanceof Error ? err.message : "unknown network error"}`,
      { code: "NetworkError", status: 502, retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Engine error translation
// ---------------------------------------------------------------------------

export interface EngineFailure {
  code: string;
  /** What went wrong, in the user's language. */
  message: string;
  /** The concrete thing the user should change. */
  guidance: string;
}

const ENGINE_ERRORS: Record<string, EngineFailure> = {
  error_face_not_forward_facing: {
    code: "error_face_not_forward_facing",
    message: "Your face is not facing the camera.",
    guidance:
      "Turn to look straight at the lens, with both eyes visible and your head level.",
  },
  error_face_angle_downward: {
    code: "error_face_angle_downward",
    message: "Your head is tilted down.",
    guidance: "Raise your chin so you are looking level at the camera.",
  },
  error_face_angle_upward: {
    code: "error_face_angle_upward",
    message: "Your head is tilted up.",
    guidance: "Lower your chin so you are looking level at the camera.",
  },
  error_face_angle_invalid: {
    code: "error_face_angle_invalid",
    message: "Your head is turned too far.",
    guidance: "Keep your head within about 10 degrees of straight-on for a front photo.",
  },
  error_face_position_too_small: {
    code: "error_face_position_too_small",
    message: "Your face is too small in the frame.",
    guidance:
      "Move closer or crop the photo so your face fills more than half the width of the image.",
  },
  error_face_position_out_of_boundary: {
    code: "error_face_position_out_of_boundary",
    message: "Part of your face is outside the frame.",
    guidance: "Retake the photo with your whole face, hairline to chin, inside the image.",
  },
  error_face_position_invalid: {
    code: "error_face_position_invalid",
    message: "No usable face was found.",
    guidance: "Use a clear, well-lit photo with a single face and no obstructions.",
  },
  error_face_not_found: {
    code: "error_face_not_found",
    message: "No face was detected.",
    guidance: "Use a clear, well-lit photo with a single face.",
  },
  error_below_min_image_size: {
    code: "error_below_min_image_size",
    message: "The image resolution is too low.",
    guidance: "Use an image at least 100 pixels wide and 100 pixels tall.",
  },
  error_exceed_max_image_size: {
    code: "error_exceed_max_image_size",
    message: "The image resolution is too high.",
    guidance: "Use an image whose long side is under 1920 pixels.",
  },
  exceed_max_filesize: {
    code: "exceed_max_filesize",
    message: "The file is larger than the API accepts.",
    guidance: `Use an image under ${MAX_UPLOAD_MB} MB.`,
  },
  error_multiple_people: {
    code: "error_multiple_people",
    message: "More than one person was detected.",
    guidance: "Use a photo with only you in it.",
  },
  error_lighting_too_dark: {
    code: "error_lighting_too_dark",
    message: "The photo is too dark to measure accurately.",
    guidance: "Take the photo in soft, even daylight facing a window.",
  },
  error_lighting_too_bright: {
    code: "error_lighting_too_bright",
    message: "The photo is overexposed.",
    guidance: "Avoid direct sunlight or flash; use soft, even light instead.",
  },
  invalid_parameter: {
    code: "invalid_parameter",
    message: "The makeup request was rejected as malformed.",
    guidance:
      "This is a problem with the requested look rather than your photo - try a different look, or report it.",
  },
  error_nsfw_content_detected: {
    code: "error_nsfw_content_detected",
    message: "The image was flagged as unsuitable.",
    guidance: "Use a plain, fully clothed portrait photo.",
  },
};

export function translateEngineError(code: string | null | undefined): EngineFailure {
  if (code && ENGINE_ERRORS[code]) return ENGINE_ERRORS[code];
  return {
    code: code || "unknown_engine_error",
    message: "The YouCam engine could not process this image.",
    guidance:
      "Try a well-lit, front-facing photo of one person where the face fills most of the frame.",
  };
}

/** Every engine error code we know how to explain, for the UI's help panel. */
export const KNOWN_ENGINE_ERROR_CODES = Object.keys(ENGINE_ERRORS);

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

interface FileCreateResponse {
  data: {
    files: Array<{
      file_id: string;
      requests: Array<{ url: string; headers: Record<string, string>; method: string }>;
    }>;
  };
}

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png"]);

/** Shortest upload budget worth attempting; below this we give up cleanly. */
const MIN_UPLOAD_BUDGET_MS = 2_000;

/**
 * Upload an image and return its YouCam `file_id`.
 * Validates size and MIME type before spending any API units.
 *
 * `timeoutMs` bounds the WHOLE upload (file-create plus the byte PUT), so a slow
 * presigned target cannot hold the function open past the route's deadline. The
 * PUT is the step that was previously unbounded.
 */
export async function uploadImage(
  bytes: Uint8Array,
  contentType: string,
  fileName: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  if (!ALLOWED_MIME.has(contentType.toLowerCase())) {
    throw new YouCamError("Only JPEG and PNG images are supported.", {
      code: "UnsupportedFileType",
      status: 400,
    });
  }
  if (bytes.byteLength === 0) {
    throw new YouCamError("The uploaded file is empty.", { code: "EmptyFile", status: 400 });
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new YouCamError(`The image is larger than the ${MAX_UPLOAD_MB} MB limit.`, {
      code: "FileTooLarge",
      status: 400,
    });
  }

  const budgetMs = Math.max(MIN_UPLOAD_BUDGET_MS, opts.timeoutMs ?? 60_000);
  const deadline = Date.now() + budgetMs;

  // The create call shares the budget with the PUT, so neither can starve the other.
  const created = await request<FileCreateResponse>("/s2s/v2.0/file", {
    method: "POST",
    body: {
      files: [{ content_type: contentType, file_name: fileName, file_size: bytes.byteLength }],
    },
    timeoutMs: Math.max(MIN_UPLOAD_BUDGET_MS, Math.floor(budgetMs / 2)),
  });

  const entry = created.data?.files?.[0];
  const target = entry?.requests?.[0];
  if (!entry?.file_id || !target?.url) {
    throw new YouCamError("The YouCam API did not return an upload target.", {
      code: "MissingUploadTarget",
      status: 502,
    });
  }

  // Step 2: PUT the bytes to the presigned URL, bounded by what is left. The
  // documented failure mode of skipping this step is a 500/404 from later task
  // calls, so it must complete, but it must also not run forever.
  const remaining = deadline - Date.now();
  const putController = new AbortController();
  const putTimer = setTimeout(() => putController.abort(), Math.max(MIN_UPLOAD_BUDGET_MS, remaining));
  try {
    const putRes = await fetch(target.url, {
      method: target.method || "PUT",
      headers: target.headers,
      body: new Uint8Array(bytes),
      signal: putController.signal,
    });
    if (!putRes.ok) {
      throw new YouCamError(`Uploading the image failed (${putRes.status}).`, {
        code: "UploadFailed",
        status: 502,
        retryable: true,
      });
    }
  } catch (err) {
    if (err instanceof YouCamError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new YouCamError("Uploading the image timed out.", {
        code: "UploadTimeout",
        status: 504,
        retryable: true,
      });
    }
    throw new YouCamError("Uploading the image failed.", {
      code: "UploadFailed",
      status: 502,
      retryable: true,
    });
  } finally {
    clearTimeout(putTimer);
  }

  return entry.file_id;
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

export interface TaskSource {
  fileId?: string;
  fileUrl?: string;
}

function sourceFields(source: TaskSource): Record<string, string> {
  if (source.fileId) return { src_file_id: source.fileId };
  if (source.fileUrl) return { src_file_url: source.fileUrl };
  throw new YouCamError("A file id or file url is required to start a task.", {
    code: "MissingSource",
    status: 400,
  });
}

interface CreateTaskResponse {
  data: { task_id: string };
}

export interface TaskData {
  task_status: string;
  error?: string | null;
  error_message?: string | null;
  results?: unknown;
  failure_reason?: string | null;
}

export interface PollOptions {
  /**
   * Total wall-clock budget for the whole task (start + every poll). Must stay
   * strictly below the route's `maxDuration`, or the platform kills the function
   * mid-flight and a paid task is left running upstream.
   */
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

const TERMINAL = new Set(["success", "error"]);

/** Shortest time worth spending on a poll; below this we give up cleanly. */
const MIN_POLL_BUDGET_MS = 1_500;

/**
 * Start a task and poll until it reaches a terminal state.
 *
 * Every poll is bounded by the REMAINING budget, so the final request can never
 * outlive the deadline. Throws YouCamError only for transport/auth/timeout
 * problems; an engine failure is returned so the caller can show guidance (and
 * note that no units were spent).
 */
export async function runTask(
  path: TaskPath,
  body: Record<string, unknown>,
  opts: PollOptions = {},
): Promise<TaskData> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  // The poll interval is overridable so tests do not spend seconds sleeping.
  const envInterval = Number(process.env.YOUCAM_POLL_INTERVAL_MS ?? "");
  const intervalMs = opts.intervalMs ?? (Number.isFinite(envInterval) && envInterval > 0 ? envInterval : 2_000);
  const deadline = Date.now() + timeoutMs;

  // The create call shares the budget: it must not eat the whole window.
  const created = await request<CreateTaskResponse>(path, {
    method: "POST",
    body,
    timeoutMs: Math.max(MIN_POLL_BUDGET_MS, Math.floor(timeoutMs / 4)),
  });
  const taskId = created?.data?.task_id;
  if (!taskId) {
    throw new YouCamError("The YouCam API did not return a task id.", {
      code: "MissingTaskId",
      status: 502,
    });
  }

  let attempt = 0;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      throw new YouCamError("The request was cancelled.", { code: "Aborted", status: 499 });
    }
    // Mild backoff: the engine usually finishes in a few seconds.
    const wait = Math.min(intervalMs * (1 + attempt * 0.25), 5_000);
    const remainingAfterWait = deadline - Date.now() - wait;
    if (remainingAfterWait < MIN_POLL_BUDGET_MS) break;
    await new Promise((r) => setTimeout(r, wait));
    attempt++;

    const remaining = deadline - Date.now();
    if (remaining < MIN_POLL_BUDGET_MS) break;

    // The poll's own timeout is capped by what is left, so it cannot overrun.
    const res = await request<{ data: TaskData }>(`${path}/${encodeURIComponent(taskId)}`, {
      timeoutMs: Math.min(30_000, remaining),
    });
    const data = res?.data;
    if (!data?.task_status) {
      throw new YouCamError("The YouCam API returned a task with no status.", {
        code: "MalformedTaskResponse",
        status: 502,
      });
    }
    if (TERMINAL.has(data.task_status)) return data;
  }

  throw new YouCamError("The YouCam task did not finish in time.", {
    code: "TaskTimeout",
    status: 504,
    retryable: true,
  });
}

// ---------------------------------------------------------------------------
// Typed feature calls
// ---------------------------------------------------------------------------

export interface SkinToneResults {
  color?: {
    skin_color?: string;
    skin_color_name?: string;
    lip_color?: string;
    eye_color?: string;
    eye_color_name?: string;
    eyebrow_color?: string;
    hair_color?: string;
    hair_color_name?: string;
  };
  face_quality?: {
    has_face?: boolean;
    area?: string;
    frontal?: string;
    lighting?: string;
    faceangle?: string;
  };
}

export interface SkinToneOutcome {
  ok: boolean;
  results?: SkinToneResults;
  failure?: EngineFailure;
}

/** Measure facial colors. Costs 20 units on success, 0 on engine error. */
export async function analyzeSkinTone(
  source: TaskSource,
  opts: PollOptions & { faceAngleStrictness?: string } = {},
): Promise<SkinToneOutcome> {
  const data = await runTask(
    "/s2s/v2.0/task/skin-tone-analysis",
    {
      ...sourceFields(source),
      ...(opts.faceAngleStrictness
        ? { face_angle_strictness_level: opts.faceAngleStrictness }
        : {}),
    },
    opts,
  );

  if (data.task_status === "success") {
    return { ok: true, results: (data.results ?? {}) as SkinToneResults };
  }
  return { ok: false, failure: translateEngineError(data.error ?? data.failure_reason) };
}

export interface MakeupEffect {
  category: string;
  [key: string]: unknown;
}

export interface MakeupOutcome {
  ok: boolean;
  /** URL of the rendered image, valid for a limited time. */
  imageUrl?: string;
  failure?: EngineFailure;
}

/** Render a makeup look. Costs 1 unit on success, 0 on engine error. */
export async function applyMakeup(
  source: TaskSource,
  effects: MakeupEffect[],
  opts: PollOptions = {},
): Promise<MakeupOutcome> {
  const data = await runTask(
    "/s2s/v2.0/task/makeup-vto",
    { ...sourceFields(source), effects, version: "1.0" },
    opts,
  );

  if (data.task_status !== "success") {
    return { ok: false, failure: translateEngineError(data.error ?? data.failure_reason) };
  }

  const results = data.results as
    | { url?: string; download_url?: string; [k: string]: unknown }
    | Array<{ url?: string; download_url?: string }>
    | undefined;

  const url = Array.isArray(results)
    ? (results[0]?.url ?? results[0]?.download_url)
    : (results?.url ?? results?.download_url);

  if (!url) {
    throw new YouCamError("The YouCam API reported success but returned no image.", {
      code: "MissingResultUrl",
      status: 502,
    });
  }
  return { ok: true, imageUrl: url };
}
