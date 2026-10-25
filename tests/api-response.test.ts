/**
 * Response-parsing tests.
 *
 * The defect these pin: the client called `res.json()` directly and treated any
 * throw as a network failure. Vercel answers an oversized upload with a
 * platform-level 413 and a plain-text body, so `res.json()` threw and the user
 * was told "Could not reach the analysis endpoint" - a wrong diagnosis of a
 * fixable size problem. `readApiResult` separates the three cases: a real
 * response, an HTTP error, and a genuine network failure.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readApiResult, networkFailure } from "../src/lib/api-response.ts";

test("a successful JSON response is returned as the result", async () => {
  const res = new Response(JSON.stringify({ ok: true, source: "recorded" }), { status: 200 });
  const result = await readApiResult<{ ok: true; source: string }>(res);
  assert.deepEqual(result, { ok: true, source: "recorded" });
});

test("a platform 413 with a plain-text body is reported as a size problem", async () => {
  // This is what Vercel returns before the function runs.
  const res = new Response("Request Entity Too Large", { status: 413 });
  const result = await readApiResult<{ ok: true }>(res);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "FileTooLarge");
  assert.match(result.title, /too large/i);
  assert.match(result.guidance, /smaller|compress/i);
  assert.doesNotMatch(result.title, /reach/i, "a 413 is not a connectivity failure");
});

test("a structured error body from the route is preserved", async () => {
  const res = new Response(
    JSON.stringify({ ok: false, code: "InvalidApiKey", title: "Bad key", message: "nope", guidance: "fix the key" }),
    { status: 401 },
  );
  const result = await readApiResult<{ ok: true }>(res);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "InvalidApiKey");
  assert.equal(result.title, "Bad key");
  assert.equal(result.guidance, "fix the key");
});

test("an unstructured 500 reports the status rather than the network", async () => {
  const res = new Response("Internal Server Error", { status: 500 });
  const result = await readApiResult<{ ok: true }>(res);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "HTTP_500");
  assert.equal(result.retryable, true);
  assert.doesNotMatch(result.title, /reach/i);
});

test("a 200 with a non-JSON body is reported as unreadable, not a success", async () => {
  const res = new Response("<html>gateway</html>", { status: 200 });
  const result = await readApiResult<{ ok: true }>(res);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "UnreadableResponse");
});

test("the network-failure helper is distinct from every HTTP error", () => {
  const failure = networkFailure("analysis");
  assert.equal(failure.code, "NetworkError");
  assert.match(failure.title, /Could not reach the analysis endpoint/);
  assert.equal(failure.retryable, true);
});
