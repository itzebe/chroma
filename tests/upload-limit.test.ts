/**
 * Upload-size policy tests.
 *
 * The regression these pin: the app advertised and enforced a 10 MB limit, but
 * Vercel rejects any request body over 4.5 MB at the platform edge before the
 * route runs. Photos between 4 MB and 10 MB therefore failed on deploy with a
 * misleading "could not reach the server" message. The limit is now 4 MB, shared
 * by the browser check and the server guard, and both are asserted here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, fileSizeError, formatMegabytes } from "../src/lib/upload-limit.ts";
import { uploadImage, YouCamError } from "../src/lib/youcam.ts";

test("the limit is 4 MB and stays under Vercel's 4.5 MB body cap", () => {
  assert.equal(MAX_UPLOAD_BYTES, 4 * 1024 * 1024);
  assert.equal(MAX_UPLOAD_MB, 4);
  assert.ok(MAX_UPLOAD_BYTES < 4.5 * 1024 * 1024, "must leave room for multipart overhead");
});

test("fileSizeError accepts a file at the limit and rejects one over it", () => {
  assert.equal(fileSizeError(MAX_UPLOAD_BYTES), null, "exactly at the limit is allowed");
  assert.equal(fileSizeError(1024), null);
  const err = fileSizeError(MAX_UPLOAD_BYTES + 1);
  assert.ok(err && err.includes("over the 4 MB limit"), "explains the limit");
  assert.ok(err && /compress|smaller/i.test(err), "tells the user what to do");
});

test("formatMegabytes reports the size the message shows", () => {
  assert.equal(formatMegabytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatMegabytes(4 * 1024 * 1024 + 1), "4.0 MB");
});

test("uploadImage rejects a file over the limit without calling the API", async () => {
  const original = globalThis.fetch;
  process.env.YOUCAM_API_KEY = "test-key";
  process.env.YOUCAM_API_BASE_URL = "https://api.example.test";
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    await assert.rejects(
      () => uploadImage(oversized, "image/jpeg", "big.jpg"),
      (err: unknown) => err instanceof YouCamError && err.code === "FileTooLarge",
    );
    assert.equal(called, false, "an oversized file must not reach the network");
  } finally {
    globalThis.fetch = original;
  }
});

test("uploadImage accepts a file exactly at the limit", async () => {
  const original = globalThis.fetch;
  process.env.YOUCAM_API_KEY = "test-key";
  process.env.YOUCAM_API_BASE_URL = "https://api.example.test";
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    String(input).includes("/s2s/v2.0/file")
      ? new Response(
          JSON.stringify({
            status: 200,
            data: { files: [{ file_id: "f1", requests: [{ method: "PUT", url: "https://up.test/1", headers: {} }] }] },
          }),
          { status: 200 },
        )
      : new Response("", { status: 200 })) as typeof fetch;
  try {
    const atLimit = new Uint8Array(MAX_UPLOAD_BYTES);
    const fileId = await uploadImage(atLimit, "image/jpeg", "ok.jpg");
    assert.equal(fileId, "f1");
  } finally {
    globalThis.fetch = original;
  }
});
