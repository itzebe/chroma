/**
 * Access-control and paid-budget regression tests.
 *
 * These drive the real routes and the real Redis client (with the Upstash REST
 * endpoint stubbed), so they exercise the same guard code production runs.
 * The behaviours pinned here are the ones that protect the paid YouCam account:
 * cross-origin and unauthenticated requests are refused, the daily ceiling
 * cannot be exceeded, and the guard fails CLOSED when the store is unreachable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { installStub, postFile, postJson, primeSecurityEnv, setSecurityEnv } from "./support/transport.ts";

await primeSecurityEnv();
setSecurityEnv();
const { POST: analyzePOST } = await import("../src/app/api/analyze/route.ts");
// render route is exercised in render-ticket.test.ts

// ---------------------------------------------------------------------------
// Origin and authentication
// ---------------------------------------------------------------------------

test("a cross-origin request is rejected with 403 and makes no paid call", async () => {
  const stub = installStub();
  try {
    const res = await analyzePOST(postJson("/api/analyze", { preferRecorded: true }, { origin: "https://evil.example" }));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "Forbidden");
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
  }
});

test("a same-origin request is allowed", async () => {
  const stub = installStub();
  try {
    const res = await analyzePOST(postJson("/api/analyze", { preferRecorded: true }, { origin: "https://app.test" }));
    assert.equal(res.status, 200);
  } finally {
    stub.restore();
  }
});

test("an unauthenticated request is rejected with 401 when a token is required", async () => {
  setSecurityEnv({ CHROMA_API_TOKEN: "expected-token" });
  const stub = installStub();
  try {
    const res = await analyzePOST(postJson("/api/analyze", { preferRecorded: true }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "Unauthorized");

    const withToken = await analyzePOST(
      postJson("/api/analyze", { preferRecorded: true }, { authorization: "Bearer expected-token" }),
    );
    assert.equal(withToken.status, 200, "a valid bearer token is accepted");
  } finally {
    stub.restore();
    setSecurityEnv();
  }
});

test("a wrong bearer token is rejected", async () => {
  setSecurityEnv({ CHROMA_API_TOKEN: "expected-token" });
  const stub = installStub();
  try {
    const res = await analyzePOST(postJson("/api/analyze", { preferRecorded: true }, { authorization: "Bearer wrong-token" }));
    assert.equal(res.status, 401);
  } finally {
    stub.restore();
    setSecurityEnv();
  }
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

test("the per-IP rate limit returns 429 once the window is full", async () => {
  setSecurityEnv({ CHROMA_RATE_LIMIT_PER_MIN: "2" });
  // The reserve script reports "rate_limited" when the IP counter is over.
  const stub = installStub({ redis: { evalResult: [0, "rate_limited"] } });
  try {
    const res = await analyzePOST(postFile("/api/analyze", new Uint8Array([1, 2, 3])));
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.code, "RateLimited");
    assert.equal(body.unitsSpent, false);
    assert.equal(stub.paidCalls().length, 0, "a rate-limited request must not reach the API");
  } finally {
    stub.restore();
    setSecurityEnv();
  }
});

test("the global daily ceiling returns 429 and never calls the API", async () => {
  const stub = installStub({ redis: { evalResult: [0, "budget_exhausted"] } });
  try {
    const res = await analyzePOST(postFile("/api/analyze", new Uint8Array([1, 2, 3])));
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.code, "BudgetExhausted");
    assert.equal(body.unitsSpent, false);
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// Fail-closed behaviour
// ---------------------------------------------------------------------------

test("a spending request fails CLOSED (503) when the budget store is unreachable", async () => {
  const stub = installStub({ redis: { mode: "down" } });
  try {
    const res = await analyzePOST(postFile("/api/analyze", new Uint8Array([1, 2, 3])));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, "BudgetUnavailable");
    assert.equal(body.unitsSpent, false);
    assert.equal(stub.paidCalls().length, 0, "fail-closed means no upstream call");
  } finally {
    stub.restore();
  }
});

test("a free recorded request still works when the budget store is unreachable", async () => {
  const stub = installStub({ redis: { mode: "down" } });
  try {
    const res = await analyzePOST(postJson("/api/analyze", { preferRecorded: true }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, "recorded");
    assert.equal(stub.paidCalls().length, 0, "the recorded path never calls the paid API");
  } finally {
    stub.restore();
  }
});

test("with no budget store configured at all, spending requests fail closed", async () => {
  setSecurityEnv({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
  const stub = installStub();
  try {
    const res = await analyzePOST(postFile("/api/analyze", new Uint8Array([1, 2, 3])));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "BudgetUnavailable");
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
    setSecurityEnv();
  }
});

// ---------------------------------------------------------------------------
// Unit accounting
// ---------------------------------------------------------------------------

test("the analyse reserve charges exactly the documented 20 units", async () => {
  const stub = installStub();
  try {
    await analyzePOST(postFile("/api/analyze", new Uint8Array([1, 2, 3])));
    const evalCall = stub.calls.find((c) => c.url.includes("redis.test") && c.body?.includes('"eval"'));
    assert.ok(evalCall, "a reserve script ran");
    const args = JSON.parse(evalCall!.body!) as unknown[];
    assert.equal(args[args.length - 3], 20, "the analysis cost is 20 units");
  } finally {
    stub.restore();
  }
});

test("a failed upstream call refunds the reserved units", async () => {
  // The engine returns a hard failure, so the analyse result is not ok.
  const stub = installStub({
    youcam: (url, init) => {
      if (url.includes("/skin-tone-analysis") && init.method === "POST") {
        return new Response(JSON.stringify({ status: 200, data: { task_id: "s1" } }), { status: 200 });
      }
      if (url.includes("/skin-tone-analysis/s1")) {
        return new Response(
          JSON.stringify({ status: 200, data: { task_status: "error", error: "error_face_not_found" } }),
          { status: 200 },
        );
      }
      return undefined;
    },
  });
  try {
    const res = await analyzePOST(postFile("/api/analyze", new Uint8Array([1, 2, 3])));
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.unitsSpent, false);
    // A settle with a negative delta is the refund.
    const refund = stub.calls.find(
      (c) => c.url.includes("redis.test") && c.body?.includes('"eval"') && c.body.includes("-20"),
    );
    assert.ok(refund, "a failed operation must refund its reservation");
  } finally {
    stub.restore();
  }
});
