/**
 * SSRF regression tests.
 *
 * Two layers are covered. The pure guards (address classification, URL checks,
 * response assessment, stream caps) are tested directly. Then the REAL
 * /api/analyze route is driven with real `Request` objects and a stubbed
 * transport, and every blocked case also asserts that NO outbound call was made
 * - a refused URL must never reach the network, let alone the paid endpoints.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAddress, isBlockedAddress, isBlockedHostname } from "../src/lib/security/network.ts";
import {
  ImageSourceError,
  assertFetchableUrl,
  assessImageResponse,
  consumeImageStream,
  finalizeImage,
  sniffImageType,
} from "../src/lib/security/image-fetch.ts";
import { installStub, postJson, setSecurityEnv } from "./support/transport.ts";

setSecurityEnv();
const { POST: analyzePOST } = await import("../src/app/api/analyze/route.ts");

/** Run an analyse request with a URL, returning the response and outbound count. */
async function analyzeUrl(imageUrl: string) {
  const stub = installStub();
  try {
    const res = await analyzePOST(postJson("/api/analyze", { imageUrl }));
    const body = await res.json();
    // Count only YouCam calls; the Redis budget guard is a separate concern.
    const outbound = stub.calls.filter((c) => !c.url.includes("redis.test")).length;
    return { status: res.status, body, outbound };
  } finally {
    stub.restore();
  }
}

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

test("loopback, private, link-local and reserved IPv4 ranges are blocked", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
  ]) {
    assert.equal(classifyAddress(address), "blocked", `${address} must be blocked`);
  }
});

test("public IPv4 addresses are allowed", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
    assert.equal(classifyAddress(address), "public", `${address} must be public`);
  }
});

test("IPv6 loopback, unique-local, link-local and IPv4-mapped ranges are blocked", () => {
  for (const address of [
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "2001:db8::1",
  ]) {
    assert.equal(classifyAddress(address), "blocked", `${address} must be blocked`);
  }
});

test("public IPv6 addresses are allowed", () => {
  assert.equal(classifyAddress("2606:4700:4700::1111"), "public");
});

test("internal hostnames and bare labels are blocked by name", () => {
  for (const host of ["localhost", "foo.localhost", "db.internal", "printer.local", "metadata", ""]) {
    assert.equal(isBlockedHostname(host), true, `${host} must be blocked`);
  }
  assert.equal(isBlockedHostname("example.com"), false);
});

test("a literal IP hostname is judged by its address", () => {
  assert.equal(isBlockedHostname("127.0.0.1"), true);
  assert.equal(isBlockedHostname("8.8.8.8"), false);
  assert.equal(isBlockedAddress("192.168.0.1"), true);
});

// ---------------------------------------------------------------------------
// URL guard
// ---------------------------------------------------------------------------

test("assertFetchableUrl rejects http, credentials and non-default ports", () => {
  assert.throws(() => assertFetchableUrl("http://example.com/a.jpg"), ImageSourceError);
  assert.throws(() => assertFetchableUrl("https://user:pass@example.com/a.jpg"), ImageSourceError);
  assert.throws(() => assertFetchableUrl("https://example.com:8080/a.jpg"), ImageSourceError);
  assert.equal(assertFetchableUrl("https://example.com/a.jpg").hostname, "example.com");
});

// ---------------------------------------------------------------------------
// Response assessment and stream caps
// ---------------------------------------------------------------------------

test("redirects, non-200s, wrong media types and oversized declarations are refused", () => {
  const cap = 1024;
  assert.throws(() => assessImageResponse(302, "image/jpeg", "10", cap), /redirect/i);
  assert.throws(() => assessImageResponse(404, "image/jpeg", "10", cap), ImageSourceError);
  assert.throws(() => assessImageResponse(200, "text/html", "10", cap), ImageSourceError);
  assert.throws(() => assessImageResponse(200, "image/jpeg", String(cap + 1), cap), ImageSourceError);
  assert.equal(assessImageResponse(200, "image/png; charset=binary", "10", cap), "image/png");
});

test("the stream cap stops a body that grows past the limit", async () => {
  async function* flood() {
    for (let i = 0; i < 100; i++) yield new Uint8Array(100);
  }
  await assert.rejects(
    () => consumeImageStream(flood(), 250),
    (err: unknown) => err instanceof ImageSourceError && err.code === "RemoteTooLarge",
  );
});

test("magic bytes must match the declared type", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(sniffImageType(jpeg), "image/jpeg");
  assert.equal(sniffImageType(png), "image/png");
  assert.equal(sniffImageType(new Uint8Array([1, 2, 3])), null);
  assert.equal(finalizeImage(jpeg, "image/jpeg"), "image/jpeg");
  // A server that claims JPEG but sends PNG bytes is refused.
  assert.throws(() => finalizeImage(png, "image/jpeg"), ImageSourceError);
});

// ---------------------------------------------------------------------------
// Route behaviour: a blocked URL never reaches the network
// ---------------------------------------------------------------------------

test("analyze rejects an http URL without any outbound call", async () => {
  const { status, body, outbound } = await analyzeUrl("http://example.com/selfie.jpg");
  assert.equal(status, 400);
  assert.equal(body.code, "InsecureUrl");
  assert.equal(outbound, 0, "a rejected scheme must not reach the network");
});

test("analyze rejects a cloud metadata address without any outbound call", async () => {
  const { status, body, outbound } = await analyzeUrl("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
  assert.equal(status, 400);
  assert.equal(body.code, "InsecureUrl");
  assert.equal(outbound, 0);
});

test("analyze rejects loopback, private, IPv6 and internal hosts with no outbound call", async () => {
  for (const url of [
    "https://127.0.0.1/secret.jpg",
    "https://10.0.0.5/secret.jpg",
    "https://192.168.1.1/router.jpg",
    "https://169.254.169.254/meta.jpg",
    "https://[::1]/secret.jpg",
    "https://localhost/secret.jpg",
    "https://metadata.internal/x.jpg",
  ]) {
    const { status, body, outbound } = await analyzeUrl(url);
    assert.equal(status, 400, `${url} must be refused`);
    assert.equal(body.code, "BlockedHost", `${url} must report BlockedHost`);
    assert.equal(outbound, 0, `${url} must not reach the network`);
  }
});

test("a malformed URL is refused cleanly", async () => {
  const { status, body } = await analyzeUrl("not a url at all");
  assert.equal(status, 400);
  assert.equal(body.code, "BadUrl");
});

test("a public host that resolves to a private address is refused (DNS rebinding)", async () => {
  const { fetchRemoteImage } = await import("../src/lib/security/image-fetch.ts");
  let connected = false;
  // The resolve seam returns an internal address for a public-looking name.
  await assert.rejects(
    () =>
      fetchRemoteImage("https://rebind.example/x.jpg", {
        maxBytes: 1024,
        resolve: async () => {
          connected = true;
          return ["10.0.0.1"];
        },
      }),
    (err: unknown) => err instanceof ImageSourceError && err.code === "BlockedHost",
  );
  assert.equal(connected, true, "the resolver was consulted");
});

test("a host with one public and one private address is refused", async () => {
  const { fetchRemoteImage } = await import("../src/lib/security/image-fetch.ts");
  await assert.rejects(
    () => fetchRemoteImage("https://mixed.example/x.jpg", { maxBytes: 1024, resolve: async () => ["93.184.216.34", "192.168.0.1"] }),
    (err: unknown) => err instanceof ImageSourceError && err.code === "BlockedHost",
  );
});
