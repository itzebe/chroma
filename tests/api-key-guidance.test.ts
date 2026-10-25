/**
 * Invalid-API-key guidance tests.
 *
 * The defect these pin: every non-retryable YouCam failure was answered with
 * "Check the image and the request, then try again." For a 401 the API key is
 * wrong, so that advice sends the user to change their photo - something that
 * cannot possibly fix a server-side credential problem. The message must name
 * the key and point at the server configuration instead.
 *
 * `analyze` is driven for real against a stubbed transport, so the mapping from
 * a 401 response to user-facing guidance is the same code the app runs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/lib/pipeline.ts";

const bytes = new Uint8Array([1, 2, 3]);

function withStubbedFetch<T>(handler: (url: string) => Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  process.env.YOUCAM_API_KEY = "test-key";
  process.env.YOUCAM_API_BASE_URL = "https://api.example.test";
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Invalid API key", error_code: "InvalidApiKey" }), {
    status: 401,
  });
}

test("a rejected API key names the key and the fix, not the photo", async () => {
  const result = await withStubbedFetch(unauthorized, () => analyze({ bytes }));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "InvalidApiKey");
  assert.match(result.guidance, /YOUCAM_API_KEY/, "tells the operator which variable to check");
  assert.match(result.guidance, /key/i);
  assert.doesNotMatch(
    result.guidance,
    /check the image/i,
    "must not send the user to fix their photo for a credential problem",
  );
  assert.equal(result.retryable, false, "retrying will not fix a rejected key");
});

test("a 401 without an error code is still treated as an auth failure", async () => {
  const result = await withStubbedFetch(
    () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    () => analyze({ bytes }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.guidance, /YOUCAM_API_KEY/);
  assert.equal(result.retryable, false);
});

test("a 403 is treated as an auth failure too", async () => {
  const result = await withStubbedFetch(
    () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    () => analyze({ bytes }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.guidance, /YOUCAM_API_KEY/);
});

test("an out-of-units failure keeps its own dedicated guidance", async () => {
  const result = await withStubbedFetch(
    () => new Response(JSON.stringify({ error: "Insufficient credits", error_code: "CreditInsufficiency" }), { status: 400 }),
    () => analyze({ bytes }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "CreditInsufficiency");
  assert.match(result.guidance, /units/i);
  assert.doesNotMatch(result.guidance, /YOUCAM_API_KEY/, "units and keys are different problems");
});
