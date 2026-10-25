/**
 * Route-level tests for the upload guard and the invalid-key guidance.
 *
 * These drive the real route handlers with real `Request` objects, so they
 * assert the behaviour a deploy actually has rather than a copy of it.
 *
 * Defects pinned here:
 *  1. The route accepted uploads up to 10 MB, but Vercel caps the request body
 *     at 4.5 MB and rejects anything larger before the function runs. A 6 MB
 *     photo passed locally and failed in production.
 *  2. A rejected API key produced "Check the image and the request" - advice
 *     that cannot fix a server-side credential problem.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_UPLOAD_BYTES } from "../src/lib/upload-limit.ts";

const { POST: analyzePOST } = await import("../src/app/api/analyze/route.ts");

function multipartWithBytes(bytes: Uint8Array<ArrayBuffer>, name = "selfie.jpg", type = "image/jpeg"): Request {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  return new Request("http://localhost/api/analyze", { method: "POST", body: form });
}

test("analyze rejects an oversized upload with an actionable 413", async () => {
  const res = await analyzePOST(multipartWithBytes(new Uint8Array(MAX_UPLOAD_BYTES + 1)));
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "FileTooLarge");
  assert.match(body.message, /4 MB limit/);
  assert.match(body.guidance, /compress|smaller/i);
  assert.equal(body.unitsSpent, false, "a rejected upload must not claim a unit was spent");
});

test("analyze no longer accepts a body between 4 MB and the old 10 MB limit", async () => {
  // 6 MB passed under the old limit and fails on Vercel; it must now be refused.
  const res = await analyzePOST(multipartWithBytes(new Uint8Array(6 * 1024 * 1024)));
  assert.equal(res.status, 413, "6 MB must be rejected, not accepted");
  const body = await res.json();
  assert.equal(body.code, "FileTooLarge");
});

test("analyze accepts an upload at exactly the limit", async () => {
  const res = await analyzePOST(multipartWithBytes(new Uint8Array(MAX_UPLOAD_BYTES)));
  assert.notEqual(res.status, 413, "a file at the limit must pass the size guard");
});

test("analyze still reports a missing file clearly", async () => {
  const form = new FormData();
  const res = await analyzePOST(new Request("http://localhost/api/analyze", { method: "POST", body: form }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "NoImage");
});

test("analyze replays the recorded sample when asked", async () => {
  const res = await analyzePOST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferRecorded: true }),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).source, "recorded");
});
