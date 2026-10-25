/**
 * Turn a fetch response into a result the UI can render, without mistaking an
 * HTTP error for a network failure.
 *
 * The failure this guards against: Vercel returns a platform-level 413 with a
 * plain-text body before the route runs. Calling `res.json()` on that throws,
 * and a naive catch reports "could not reach the server" - the wrong diagnosis.
 * A real network failure throws from `fetch` itself; an HTTP error does not.
 */

export interface ApiFailure {
  ok: false;
  code: string;
  title: string;
  message: string;
  guidance: string;
  retryable: boolean;
  unitsSpent: boolean;
  source: "live" | "recorded";
}

/**
 * The result for a genuine network failure, i.e. `fetch` itself threw and no
 * response exists. Kept separate from `readApiResult` so an HTTP error is never
 * described this way.
 */
export function networkFailure(endpoint: string): ApiFailure {
  return {
    ok: false,
    code: "NetworkError",
    title: `Could not reach the ${endpoint} endpoint`,
    message: "The request to the server failed.",
    guidance: "Check that the server is running, then try again.",
    retryable: true,
    unitsSpent: false,
    source: "live",
  };
}

/** True when a parsed body is the structured failure shape the routes return. */
function isApiFailure(value: unknown): value is ApiFailure {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.ok === false &&
    typeof v.title === "string" &&
    typeof v.message === "string" &&
    typeof v.guidance === "string"
  );
}

export async function readApiResult<T>(res: Response): Promise<T | ApiFailure> {
  const text = await res.text().catch(() => "");

  let parsed: unknown = null;
  let parsedOk = false;
  if (text) {
    try {
      parsed = JSON.parse(text);
      parsedOk = true;
    } catch {
      parsedOk = false;
    }
  }

  if (res.ok && parsedOk) return parsed as T;

  // A structured failure from the route carries specific, actionable guidance
  // (for example the invalid-key advice). Preserve it instead of replacing it
  // with a generic status message.
  if (parsedOk && isApiFailure(parsed)) return parsed;

  if (res.status === 413) {
    return {
      ok: false,
      code: "FileTooLarge",
      title: "That image is too large",
      message:
        "The server refused the upload because it is over the size limit for this deployment.",
      guidance: "Choose a smaller photo, or compress this one and try again.",
      retryable: false,
      unitsSpent: false,
      source: "live",
    };
  }

  // An HTTP error that is not the structured JSON the route returns: report the
  // status rather than blaming the network.
  if (!res.ok) {
    return {
      ok: false,
      code: `HTTP_${res.status}`,
      title: `The server returned an error (HTTP ${res.status})`,
      message:
        (parsedOk && parsed && typeof (parsed as { message?: unknown }).message === "string"
          ? (parsed as { message: string }).message
          : text.slice(0, 200)) || "The server returned an empty error response.",
      guidance: "Try again. If it keeps happening, the server may be misconfigured.",
      retryable: res.status >= 500,
      unitsSpent: false,
      source: "live",
    };
  }

  // HTTP 200 with a body that is not JSON.
  return {
    ok: false,
    code: "UnreadableResponse",
    title: "The server returned an unreadable response",
    message: "The response was not in the expected format.",
    guidance: "Try again.",
    retryable: true,
    unitsSpent: false,
    source: "live",
  };
}
