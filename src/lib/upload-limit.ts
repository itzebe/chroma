/**
 * Upload size policy, shared by the browser and the route handler.
 *
 * Vercel rejects a request body larger than 4.5 MB at the platform edge, before
 * the function runs, so the limit here is deliberately below that. The browser
 * check gives an instant, specific message; the route check is the guard that
 * actually enforces the policy, because the browser can be bypassed.
 */

/** 4 MB. Below Vercel's 4.5 MB platform body limit. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const MAX_UPLOAD_MB = 4;

export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The message to show when a chosen file is too large, or null when it fits. */
export function fileSizeError(bytes: number): string | null {
  if (bytes > MAX_UPLOAD_BYTES) {
    return `That image is ${formatMegabytes(bytes)}, over the ${MAX_UPLOAD_MB} MB limit. Choose a smaller photo, or compress this one and try again.`;
  }
  return null;
}
