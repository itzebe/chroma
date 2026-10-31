/**
 * Render tickets.
 *
 * The render route needs the measurement and the photo reference that the
 * browser is displaying. Earlier the browser posted both back, which meant a
 * client could claim a `source` of "live", invent colours, or borrow the
 * recorded sample's photo and get makeup composited onto a stock face.
 *
 * A ticket fixes that: the analyse route seals the measurement and the true
 * photo reference into an HMAC-signed, short-lived token. The render route
 * trusts only what it can verify, so provenance is derived from server state
 * and a client cannot manufacture a live measurement.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface RenderTicket {
  /** Opaque photo reference the analyse route actually used. */
  fileId?: string;
  fileUrl?: string;
  /** Measurement, exactly as the analyse route computed it. */
  measured: Record<string, string | undefined>;
  quality: Record<string, string | boolean | null | undefined>;
  source: "live" | "recorded";
  /** Epoch milliseconds; the ticket is refused after this. */
  expiresAt: number;
}

/** Signing key. Derived from a dedicated secret, never from the YouCam key. */
function signingKey(): Buffer | null {
  const secret = process.env.CHROMA_TICKET_SECRET;
  if (!secret || secret.length < 16) return null;
  return Buffer.from(secret, "utf8");
}

function b64url(input: Buffer): string {
  return input.toString("base64url");
}

/** True when ticket signing is available. */
export function ticketSigningConfigured(): boolean {
  return signingKey() !== null;
}

/**
 * Seal a ticket. Returns null when no signing key is configured, so callers can
 * fall back to the recorded-only workflow rather than issuing unsigned tokens.
 */
export function issueTicket(ticket: RenderTicket): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload = b64url(Buffer.from(JSON.stringify(ticket), "utf8"));
  const mac = b64url(createHmac("sha256", key).update(payload).digest());
  return `${payload}.${mac}`;
}

/** Verify and decode a ticket. Returns null for anything unsigned, tampered or expired. */
export function verifyTicket(token: string | undefined): RenderTicket | null {
  if (!token) return null;
  const key = signingKey();
  if (!key) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = createHmac("sha256", key).update(payload).digest();
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let parsed: RenderTicket;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed?.expiresAt !== "number" || Date.now() > parsed.expiresAt) return null;
  if (parsed.source !== "live" && parsed.source !== "recorded") return null;
  if (!parsed.measured || typeof parsed.measured !== "object") return null;
  return parsed;
}
