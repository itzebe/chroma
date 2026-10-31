/**
 * Error hygiene.
 *
 * Upstream and runtime exceptions are logged with full detail server-side, but
 * never returned to the browser: an exception message can carry internal
 * hostnames, addresses, status codes or request fragments. Routes return stable,
 * user-facing text instead, and the honest failure taxonomy (codes, retryable,
 * unitsSpent) is preserved.
 */

import { YouCamError } from "./youcam.ts";

/** Structured, secret-free detail for the server log. */
export interface LoggedError {
  code: string;
  status: number;
  message: string;
  retryable: boolean;
}

export function describeError(err: unknown): LoggedError {
  if (err instanceof YouCamError) {
    return { code: err.code, status: err.status, message: err.message, retryable: err.retryable };
  }
  if (err instanceof Error) {
    return { code: err.name || "Error", status: 500, message: err.message, retryable: false };
  }
  return { code: "Unknown", status: 500, message: String(err), retryable: false };
}

/** Log an upstream/runtime failure with detail. Server-side only. */
export function logServerError(scope: string, err: unknown): void {
  const detail = describeError(err);
  console.error(`[chroma:${scope}]`, detail.code, detail.status, detail.message);
}

/** True when an error message indicates the API account is out of units. */
export function looksLikeCreditError(message: string): boolean {
  return /credit|insufficient|quota|balance/i.test(message);
}
