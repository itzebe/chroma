/**
 * Error-message hygiene tests.
 *
 * The regression these pin: upstream and runtime exception messages were
 * returned verbatim to the browser. A YouCam failure can carry an internal
 * hostname, an HTTP status, or a fragment of the request, so the route must
 * return stable, user-facing text and keep the detail in the server log.
 *
 * These drive the REAL route with a stubbed transport that returns hostile
 * upstream bodies and assert the response body never contains them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeError, logServerError, looksLikeCreditError } from "../src/lib/errors.ts";
import { YouCamError } from "../src/lib/youcam.ts";
import { installStub, postFile, postJson, primeSecurityEnv, setSecurityEnv } from "./support/transport.ts";

await primeSecurityEnv();
setSecurityEnv();
const { POST: analyzePOST } = await import("../src/app/api/analyze/route.ts");

/** A secret-looking string an upstream body might contain. */
const LEAK = "internal-host-10.0.0.5-8f3a9c";

// ---------------------------------------------------------------------------
// describeError
// ---------------------------------------------------------------------------

test("describeError keeps the code and status for the log", () => {
  const detail = describeError(new YouCamError("boom", { code: "CreditInsufficiency", status: 402, retryable: false }));
  assert.equal(detail.code, "CreditInsufficiency");
  assert.equal(detail.status, 402);
  assert.equal(detail.retryable, false);
});

test("describeError handles non-Error throwables", () => {
  assert.equal(describeError("just a string").code, "Unknown");
  assert.equal(describeError({ weird: true }).code, "Unknown");
});

test("logServerError writes the detail to the server log only", () => {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    logServerError("test", new YouCamError("upstream said " + LEAK, { code: "FetchFailed", status: 502 }));
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /chroma:test/);
  assert.match(lines[0], new RegExp(LEAK), "the log carries the real detail");
});

test("looksLikeCreditError matches the credit vocabulary only", () => {
  assert.equal(looksLikeCreditError("insufficient credit balance"), true);
  assert.equal(looksLikeCreditError("network timeout"), false);
});

// ---------------------------------------------------------------------------
// The route never returns upstream detail
// ---------------------------------------------------------------------------

test("an upstream error body is not echoed to the client", async () => {
  const stub = installStub({
    youcam: (url, init) => {
      if (url.includes("/skin-tone-analysis") && init.method === "POST") {
        // The upstream returns a body containing a sensitive-looking detail.
        return new Response(JSON.stringify({ status: 500, message: `backend exploded at ${LEAK}` }), { status: 500 });
      }
      return undefined;
    },
  });
  try {
    const res = await analyzePOST(postFile("/api/analyze", new Uint8Array([1, 2, 3])));
    const text = await res.text();
    assert.ok(!text.includes(LEAK), "the upstream detail must not reach the client");
    const body = JSON.parse(text) as Record<string, unknown>;
    assert.equal(body.ok, false);
    assert.equal(typeof body.message, "string");
    assert.equal(typeof body.guidance, "string");
  } finally {
    stub.restore();
  }
});

test("a transport exception does not leak its message to the client", async () => {
  const stub = installStub({
    youcam: (url, init) => {
      if (url.includes("/skin-tone-analysis") && init.method === "POST") {
        throw new Error(`connect ECONNREFUSED ${LEAK}`);
      }
      return undefined;
    },
  });
  try {
    const res = await analyzePOST(postFile("/api/analyze", new Uint8Array([1, 2, 3])));
    const text = await res.text();
    assert.ok(!text.includes(LEAK), "a thrown transport error must not leak");
    assert.ok(!/ECONNREFUSED/.test(text), "internal error codes must not leak");
  } finally {
    stub.restore();
  }
});

test("a rejected image URL returns user-safe text, not the internal code path", async () => {
  const stub = installStub();
  try {
    const res = await analyzePOST(postJson("/api/analyze", { imageUrl: "https://10.0.0.5/x.jpg" }));
    const text = await res.text();
    assert.ok(!/10\.0\.0\.5/.test(text), "the blocked address must not be echoed");
    assert.ok(!/\bat .*:\d+/.test(text), "no stack frames or file paths");
  } finally {
    stub.restore();
  }
});
