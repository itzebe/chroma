/**
 * SSRF-safe remote image retrieval.
 *
 * The app never forwards a user-supplied URL to the YouCam API. Instead it
 * fetches the image here, under strict rules, and uploads the validated bytes
 * so the engine only ever receives a YouCam file id.
 *
 * Defences, in order:
 *  1. https only, no credentials, no non-default port.
 *  2. Hostname must not be localhost/.local/.internal or a bare label; a literal
 *     IP must not be in a blocked range.
 *  3. The hostname is resolved once and EVERY resolved address must be public.
 *  4. The connection is pinned to those addresses via a custom `lookup`, so the
 *     name cannot be re-resolved to an internal address between the check and
 *     the request (DNS rebinding). `servername`/`host` still carry the real name
 *     so TLS verification and virtual hosting work.
 *  5. Redirects are not followed at all; a 3xx is rejected.
 *  6. Content-Type must be JPEG or PNG, and the body must start with the
 *     matching magic bytes, so a non-image cannot be smuggled through.
 *  7. The body is streamed with a hard byte ceiling and a socket timeout, so a
 *     hostile server cannot exhaust memory or hold the function open.
 *
 * Response assessment and stream consumption are factored out as pure functions
 * so the security rules can be tested directly, without a network.
 */

import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isBlockedAddress, isBlockedHostname } from "./network.ts";

/** A refusal we can explain to the user, as opposed to an infrastructure fault. */
export class ImageSourceError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ImageSourceError";
    this.code = code;
  }
}

export type ImageMediaType = "image/jpeg" | "image/png";

export interface FetchedImage {
  bytes: Uint8Array;
  contentType: ImageMediaType;
  finalUrl: string;
}

export interface FetchImageOptions {
  maxBytes: number;
  timeoutMs?: number;
  /** Test seam: replaces DNS resolution. Never used in production paths. */
  resolve?: (hostname: string) => Promise<string[]>;
}

/** JPEG and PNG magic-byte checks. */
export function sniffImageType(bytes: Uint8Array): ImageMediaType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

/**
 * Validate the status line and headers of an image response. Returns the
 * declared media type. Throws for redirects, non-200s, wrong media types and a
 * declared length over the cap.
 */
export function assessImageResponse(
  status: number,
  contentType: string | undefined,
  contentLength: string | undefined,
  maxBytes: number,
): ImageMediaType {
  if (status >= 300 && status < 400) {
    throw new ImageSourceError("Image URLs must not redirect.", "RedirectedUrl");
  }
  if (status !== 200) {
    throw new ImageSourceError(`Fetching the image failed (${status}).`, "FetchFailed");
  }
  const declared = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (declared !== "image/jpeg" && declared !== "image/png") {
    throw new ImageSourceError("That URL is not a JPEG or PNG image.", "UnsupportedMediaType");
  }
  const length = Number(contentLength ?? "0");
  if (Number.isFinite(length) && length > maxBytes) {
    throw new ImageSourceError("That image is too large to fetch.", "RemoteTooLarge");
  }
  return declared;
}

/**
 * Consume a response body, refusing the moment it exceeds `maxBytes`. Enforces
 * the size limit while the bytes are still arriving.
 */
export async function consumeImageStream(
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new ImageSourceError("That image is too large to fetch.", "RemoteTooLarge");
    parts.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/**
 * Confirm the bytes really are the media type the header claimed, using the
 * magic bytes rather than trusting the server.
 */
export function finalizeImage(bytes: Uint8Array, declared: ImageMediaType): ImageMediaType {
  const sniffed = sniffImageType(bytes);
  if (!sniffed || sniffed !== declared) {
    throw new ImageSourceError("That URL is not a JPEG or PNG image.", "UnsupportedMediaType");
  }
  return sniffed;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((r) => r.address);
}

/** Socket/overall timeout for the image fetch, overridable for testing. */
function imageFetchTimeoutMs(): number {
  const raw = process.env.CHROMA_IMAGE_FETCH_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

/**
 * Validate and parse a user-supplied image URL. Throws `ImageSourceError` with a
 * user-safe code when the URL may not be fetched.
 */
export function assertFetchableUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageSourceError("That image URL is not valid.", "BadUrl");
  }

  if (url.protocol !== "https:") {
    throw new ImageSourceError("Only https image URLs are accepted.", "InsecureUrl");
  }
  if (url.username || url.password) {
    throw new ImageSourceError("Image URLs must not contain credentials.", "BadUrl");
  }
  if (url.port && url.port !== "443") {
    throw new ImageSourceError("Image URLs must use the default https port.", "BadUrl");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new ImageSourceError("That image host is not allowed.", "BlockedHost");
  }
  return url;
}

/**
 * Fetch a remote image and return validated bytes.
 *
 * Resolves DNS once, refuses if any address is internal, then connects to those
 * exact addresses so a rebind cannot slip through.
 */
export async function fetchRemoteImage(rawUrl: string, opts: FetchImageOptions): Promise<FetchedImage> {
  const url = assertFetchableUrl(rawUrl);
  const hostname = url.hostname;
  const resolve = opts.resolve ?? defaultResolve;
  const timeoutMs = opts.timeoutMs ?? imageFetchTimeoutMs();

  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new ImageSourceError("That image host could not be resolved.", "HostUnresolved");
  }
  if (addresses.length === 0) {
    throw new ImageSourceError("That image host could not be resolved.", "HostUnresolved");
  }
  // Every candidate address must be public: a host with one internal A record is
  // rejected outright rather than relying on which address the OS picks.
  if (addresses.some((a) => isBlockedAddress(a))) {
    throw new ImageSourceError("That image host is not allowed.", "BlockedHost");
  }

  const pinned = addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  const path = `${url.pathname}${url.search}`;

  return await new Promise<FetchedImage>((resolvePromise, reject) => {
    const req = httpsRequest(
      {
        hostname,
        port: 443,
        path,
        method: "GET",
        servername: hostname,
        headers: { host: hostname, accept: "image/jpeg,image/png", "user-agent": "chroma-image-fetch/1.0" },
        lookup: (_h, _o, cb) => {
          const first = pinned[0];
          cb(null, first.address, first.family as 4 | 6);
        },
        timeout: timeoutMs,
      },
      (res) => {
        let declared: ImageMediaType;
        try {
          declared = assessImageResponse(
            res.statusCode ?? 0,
            res.headers["content-type"],
            res.headers["content-length"],
            opts.maxBytes,
          );
        } catch (err) {
          res.destroy();
          reject(err);
          return;
        }

        consumeImageStream(res as unknown as AsyncIterable<Uint8Array>, opts.maxBytes)
          .then((bytes) => {
            const contentType = finalizeImage(bytes, declared);
            resolvePromise({ bytes, contentType, finalUrl: url.href });
          })
          .catch((err) => {
            res.destroy();
            reject(err instanceof ImageSourceError ? err : new ImageSourceError("The image download failed.", "FetchFailed"));
          });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new ImageSourceError("Fetching the image timed out.", "FetchTimeout"));
    });
    req.on("error", () => reject(new ImageSourceError("The image download failed.", "FetchFailed")));
    req.end();
  });
}
