/**
 * Bounded request-body reading.
 *
 * `request.formData()` and `request.json()` buffer the whole body before any
 * size check can run, so a huge request can exhaust memory on hosts without a
 * platform body cap. These helpers refuse early on `Content-Length` and then
 * stream the body with a hard byte ceiling, so the limit is enforced while the
 * bytes are still arriving.
 */

export class BodyTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(`Request body exceeds the limit (${bytes} bytes).`);
    this.name = "BodyTooLargeError";
    this.bytes = bytes;
  }
}

export class MalformedBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedBodyError";
  }
}

/** Cheap pre-check: a declared length above the cap is refused before reading. */
export function declaredTooLarge(request: Request, limit: number): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const declared = Number(raw);
  return Number.isFinite(declared) && declared > limit;
}

/**
 * Read the body, aborting the moment it exceeds `limit` bytes.
 *
 * On overflow the read loop is left first and the stream cancelled afterwards.
 * Cancelling from inside the loop races the runtime's own teardown and surfaces
 * as an unhandled `ReadableStream is already closed` rejection.
 */
export async function readCappedBytes(request: Request, limit: number): Promise<Uint8Array> {
  const body = request.body;
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      overflow = true;
      break;
    }
    chunks.push(value);
  }

  if (overflow) {
    await body.cancel().catch(() => {});
    throw new BodyTooLargeError(total);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Parse a capped body as multipart form data, preserving the boundary. */
export async function readCappedFormData(request: Request, limit: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new MalformedBodyError("Expected a multipart/form-data request.");
  }
  const bytes = await readCappedBytes(request, limit);
  try {
    // Pass the boundary through a header, never a Blob `type`: the Blob spec
    // lowercases `type`, which corrupts a mixed-case boundary (curl and every
    // browser send one) so the body no longer matches and parsing fails.
    return await new Response(new Blob([new Uint8Array(bytes)]), {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new MalformedBodyError("The multipart body could not be parsed.");
  }
}

/** Parse a capped body as JSON. Returns an empty object for an empty body. */
export async function readCappedJson<T = unknown>(request: Request, limit: number): Promise<T> {
  const bytes = await readCappedBytes(request, limit);
  if (bytes.byteLength === 0) return {} as T;
  let text: string;
  try {
    text = new TextDecoder().decode(bytes);
  } catch {
    throw new MalformedBodyError("The request body was not valid UTF-8.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MalformedBodyError("The request body was not valid JSON.");
  }
}
