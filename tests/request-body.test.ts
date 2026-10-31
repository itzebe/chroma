/**
 * Multipart body parsing regression tests.
 *
 * The defect these pin: `readCappedFormData` rebuilt the request with
 * `new Blob([bytes], { type: contentType })`. The Blob constructor lowercases
 * `type`, so a mixed-case boundary — which curl and every browser send, e.g.
 * `----WebKitFormBoundaryAbC123` — became `----webkitformboundaryabc123` and no
 * longer matched the boundary in the bytes. Every real multipart upload then
 * failed with `MalformedBody`.
 *
 * The existing route tests could not catch this because undici's FormData
 * generates an all-lowercase boundary, so the lowercasing was a no-op there.
 * These tests build the multipart body by hand with a mixed-case boundary, the
 * way a browser does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readCappedFormData } from "../src/lib/security/request-body.ts";

const BOUNDARY = "----WebKitFormBoundaryAbC123DeF456";
const CRLF = "\r\n";

/** Build a raw multipart/form-data body with an explicit, mixed-case boundary. */
function rawMultipart(
  boundary: string,
  field: { name: string; filename?: string; type?: string; data: Uint8Array },
): Uint8Array {
  const head =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="${field.name}"` +
    (field.filename ? `; filename="${field.filename}"` : "") +
    CRLF +
    (field.type ? `Content-Type: ${field.type}${CRLF}` : "") +
    CRLF;
  const tail = `${CRLF}--${boundary}--${CRLF}`;
  const enc = new TextEncoder();
  const headBytes = enc.encode(head);
  const tailBytes = enc.encode(tail);
  const out = new Uint8Array(headBytes.length + field.data.length + tailBytes.length);
  out.set(headBytes, 0);
  out.set(field.data, headBytes.length);
  out.set(tailBytes, headBytes.length + field.data.length);
  return out;
}

function multipartRequest(boundary: string, body: Uint8Array): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
}

test("a multipart body with a mixed-case boundary parses (the bug that shipped)", async () => {
  const bytes = rawMultipart(BOUNDARY, {
    name: "file",
    filename: "selfie.jpg",
    type: "image/jpeg",
    data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  });
  const form = await readCappedFormData(multipartRequest(BOUNDARY, bytes), 1024 * 1024);
  const file = form.get("file");
  assert.ok(file instanceof File, "the file field must survive parsing");
  assert.equal(file.name, "selfie.jpg");
  assert.equal(file.size, 4);
});

test("a lowercase boundary still parses", async () => {
  const lower = "----formdata-undici-020051013407";
  const bytes = rawMultipart(lower, {
    name: "file",
    filename: "selfie.jpg",
    type: "image/jpeg",
    data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  });
  const form = await readCappedFormData(multipartRequest(lower, bytes), 1024 * 1024);
  assert.equal((form.get("file") as File).size, 4);
});

test("a non-multipart content-type is refused", async () => {
  const req = new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await assert.rejects(() => readCappedFormData(req, 1024), /multipart/);
});
