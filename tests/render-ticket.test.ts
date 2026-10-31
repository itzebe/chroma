/**
 * Render provenance and wrong-face regression tests.
 *
 * The defect these pin: the render route used to accept the measurement and the
 * photo reference from the client, and fell back to the recorded sample's photo
 * when none was supplied. A user could therefore receive makeup composited onto
 * a stock face while believing it was their own photo, and a client could label
 * a render "live".
 *
 * The fix is a signed render ticket. These tests drive the REAL analyse and
 * render routes: they prove a render is impossible without a valid ticket, that
 * the photo used is the one the ticket names, and that a client cannot forge
 * provenance or inject its own measurement.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { installStub, postFile, postJson, primeSecurityEnv, setSecurityEnv } from "./support/transport.ts";

await primeSecurityEnv();
setSecurityEnv();
const { POST: analyzePOST } = await import("../src/app/api/analyze/route.ts");
const { POST: renderPOST } = await import("../src/app/api/render/route.ts");
const { issueTicket } = await import("../src/lib/security/render-ticket.ts");

/** Obtain a real ticket by driving the real analyse route. */
async function analyseAndGetTicket(): Promise<string> {
  const stub = installStub();
  try {
    const res = await analyzePOST(postFile("/api/analyze", new Uint8Array([1, 2, 3])));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.ticket, "string", "a live analysis must issue a ticket");
    return body.ticket as string;
  } finally {
    stub.restore();
  }
}

// ---------------------------------------------------------------------------
// A render is impossible without a valid ticket
// ---------------------------------------------------------------------------

test("render with no ticket returns 400 and makes no upstream call", async () => {
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { lookId: "evening" }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "MissingTicket");
    assert.equal(stub.paidCalls().length, 0, "no photo means no paid render");
  } finally {
    stub.restore();
  }
});

test("render with a forged ticket is refused and makes no upstream call", async () => {
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { lookId: "signature", ticket: "forged.deadbeef" }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "InvalidTicket");
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
  }
});

test("render with a tampered ticket is refused", async () => {
  const ticket = await analyseAndGetTicket();
  const [payload, mac] = ticket.split(".");
  // Flip a character in the payload; the HMAC no longer matches.
  const tamperedPayload = payload.slice(0, -1) + (payload.slice(-1) === "A" ? "B" : "A");
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { lookId: "signature", ticket: `${tamperedPayload}.${mac}` }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "InvalidTicket");
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
  }
});

test("render with an expired ticket is refused", async () => {
  const expired = issueTicket({
    fileId: "file-1",
    measured: { skin_color: "#ba8e6e" },
    quality: {},
    source: "live",
    expiresAt: Date.now() - 1000,
  });
  assert.ok(expired);
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { lookId: "signature", ticket: expired! }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "InvalidTicket");
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// The photo used is the one the ticket names
// ---------------------------------------------------------------------------

test("a live render composites onto the measured file id, not a client URL", async () => {
  const ticket = await analyseAndGetTicket();
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { lookId: "signature", ticket }));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.source, "live", "provenance is derived server-side");

    const makeupCall = stub.calls.find((c) => c.url.includes("/makeup-vto") && c.method === "POST");
    assert.ok(makeupCall, "the makeup engine was called");
    const payload = JSON.parse(makeupCall!.body!) as Record<string, unknown>;
    assert.equal(payload.src_file_id, "file-1", "the measured photo id is used");
    assert.equal(payload.src_file_url, undefined, "no client URL is forwarded");
  } finally {
    stub.restore();
  }
});

test("a client cannot inject a photo URL into a render", async () => {
  const ticket = await analyseAndGetTicket();
  const stub = installStub();
  try {
    // `imageUrl` is not part of the render schema; strict parsing rejects it.
    const res = await renderPOST(
      postJson("/api/render", { lookId: "signature", ticket, imageUrl: "https://evil.example/face.jpg" }),
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "BadRequest");
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
  }
});

test("a client cannot inject a measurement into a render", async () => {
  const ticket = await analyseAndGetTicket();
  const stub = installStub();
  try {
    const res = await renderPOST(
      postJson("/api/render", { lookId: "signature", ticket, measured: { skin_color: "#ff0000" }, source: "live" }),
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "BadRequest");
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// Recorded provenance stays recorded
// ---------------------------------------------------------------------------

test("the recorded workflow still renders, labelled recorded, onto the sample photo", async () => {
  const stub = installStub();
  try {
    const analysed = await analyzePOST(postJson("/api/analyze", { preferRecorded: true }));
    const analyseBody = await analysed.json();
    assert.equal(analyseBody.source, "recorded");
    assert.equal(typeof analyseBody.ticket, "string");

    const res = await renderPOST(postJson("/api/render", { lookId: "signature", ticket: analyseBody.ticket }));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.source, "recorded", "recorded colours must not become live");

    const makeupCall = stub.calls.find((c) => c.url.includes("/makeup-vto") && c.method === "POST");
    const payload = JSON.parse(makeupCall!.body!) as Record<string, unknown>;
    assert.match(String(payload.src_file_url), /img_Face_Ratio_sec_02_02/, "the recorded sample's own photo is used");
  } finally {
    stub.restore();
  }
});

test("with ticket signing off, the recorded sample renders onto its own photo", async () => {
  // The public demo must keep working when CHROMA_TICKET_SECRET is unset. The
  // no-ticket path is narrowed to the recorded sample's own photo, so it can
  // never be used to composite onto an arbitrary face.
  const previous = process.env.CHROMA_TICKET_SECRET;
  delete process.env.CHROMA_TICKET_SECRET;
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { lookId: "signature", recordedSampleId: "reference-face" }));
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.source, "recorded", "the no-ticket path is recorded-only");

    const makeupCall = stub.calls.find((c) => c.url.includes("/makeup-vto") && c.method === "POST");
    const payload = JSON.parse(makeupCall!.body!) as Record<string, unknown>;
    assert.match(String(payload.src_file_url), /img_Face_Ratio_sec_02_02/, "only the recorded sample's own photo");
  } finally {
    stub.restore();
    process.env.CHROMA_TICKET_SECRET = previous;
  }
});

test("with ticket signing off, a no-ticket live render is still refused", async () => {
  const previous = process.env.CHROMA_TICKET_SECRET;
  delete process.env.CHROMA_TICKET_SECRET;
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { lookId: "signature" }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "MissingTicket");
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
    process.env.CHROMA_TICKET_SECRET = previous;
  }
});

test("an unknown recordedSampleId is refused without a paid call", async () => {
  const previous = process.env.CHROMA_TICKET_SECRET;
  delete process.env.CHROMA_TICKET_SECRET;
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { lookId: "signature", recordedSampleId: "no-such-sample" }));
    assert.equal(res.status, 400);
    assert.equal(stub.paidCalls().length, 0);
  } finally {
    stub.restore();
    process.env.CHROMA_TICKET_SECRET = previous;
  }
});

test("a live ticket and a recorded ticket carry different provenance", async () => {
  const liveTicket = await analyseAndGetTicket();
  const stub = installStub();
  try {
    const recordedAnalyse = await analyzePOST(postJson("/api/analyze", { preferRecorded: true }));
    const recordedTicket = (await recordedAnalyse.json()).ticket as string;

    const live = await (await renderPOST(postJson("/api/render", { lookId: "signature", ticket: liveTicket }))).json();
    const recorded = await (await renderPOST(postJson("/api/render", { lookId: "signature", ticket: recordedTicket }))).json();
    assert.equal(live.source, "live");
    assert.equal(recorded.source, "recorded");
    assert.notEqual(live.source, recorded.source);
  } finally {
    stub.restore();
  }
});

test("an unknown lookId is rejected by the schema rather than silently defaulted", async () => {
  const ticket = await analyseAndGetTicket();
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { lookId: "not-a-look", ticket }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "BadRequest");
  } finally {
    stub.restore();
  }
});

test("a valid ticket with no lookId renders the signature look", async () => {
  const ticket = await analyseAndGetTicket();
  const stub = installStub();
  try {
    const res = await renderPOST(postJson("/api/render", { ticket }));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.lookId, "signature");
  } finally {
    stub.restore();
  }
});
