/**
 * File-upload tests.
 *
 * The file-create endpoint wraps its payload in a `{ status, data }` envelope,
 * exactly like the task endpoints. `uploadImage` originally read `files` at the
 * top level, so it never found the upload target and every file upload failed
 * with `MissingUploadTarget` before spending a unit. These tests drive the real
 * function against a stubbed transport so the envelope contract stays pinned.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadImage, YouCamError } from "../src/lib/youcam.ts";

const CREATE_RESPONSE = {
  status: 200,
  data: {
    files: [
      {
        content_type: "image/jpeg",
        file_name: "selfie.jpg",
        file_id: "file-abc",
        requests: [
          {
            method: "PUT",
            url: "https://upload.example.test/put/1",
            headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
          },
        ],
      },
    ],
  },
};

const bytes = new Uint8Array([1, 2, 3]);

function withStubbedFetch<T>(handler: (url: string, init?: RequestInit) => Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  process.env.YOUCAM_API_KEY = "test-key";
  process.env.YOUCAM_API_BASE_URL = "https://api.example.test";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("uploadImage reads the file id from the response envelope", async () => {
  const calls: string[] = [];
  const fileId = await withStubbedFetch(
    (url) => {
      calls.push(url);
      return url.includes("/s2s/v2.0/file")
        ? new Response(JSON.stringify(CREATE_RESPONSE), { status: 200 })
        : new Response("", { status: 200 });
    },
    () => uploadImage(bytes, "image/jpeg", "selfie.jpg"),
  );

  assert.equal(fileId, "file-abc");
  assert.ok(calls[0].includes("/s2s/v2.0/file"), "creates the file record first");
  assert.ok(calls[1].includes("upload.example.test"), "then PUTs the bytes to the presigned URL");
});

test("uploadImage sends the bytes to the presigned URL with the returned method", async () => {
  let putInit: RequestInit | undefined;
  await withStubbedFetch(
    (url, init) => {
      if (url.includes("/s2s/v2.0/file")) return new Response(JSON.stringify(CREATE_RESPONSE), { status: 200 });
      putInit = init;
      return new Response("", { status: 200 });
    },
    () => uploadImage(bytes, "image/jpeg", "selfie.jpg"),
  );

  assert.equal(putInit?.method, "PUT");
  assert.equal((putInit?.headers as Record<string, string>)["Content-Type"], "image/jpeg");
});

test("uploadImage reports a missing upload target rather than silently continuing", async () => {
  await assert.rejects(
    () =>
      withStubbedFetch(
        () => new Response(JSON.stringify({ status: 200, data: { files: [] } }), { status: 200 }),
        () => uploadImage(bytes, "image/jpeg", "selfie.jpg"),
      ),
    (err: unknown) => err instanceof YouCamError && err.code === "MissingUploadTarget",
  );
});

test("uploadImage rejects an unsupported type before calling the API", async () => {
  let called = false;
  await assert.rejects(
    () =>
      withStubbedFetch(
        () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
        () => uploadImage(bytes, "image/gif", "anim.gif"),
      ),
    (err: unknown) => err instanceof YouCamError && err.code === "UnsupportedFileType",
  );
  assert.equal(called, false, "no network call should be made for a rejected type");
});

test("uploadImage aborts a stalled presigned PUT instead of hanging", async () => {
  // The PUT is the step that used to be unbounded. It must honour the budget.
  await assert.rejects(
    () =>
      withStubbedFetch(
        (url, init) => {
          if (url.includes("/s2s/v2.0/file")) return new Response(JSON.stringify(CREATE_RESPONSE), { status: 200 });
          // Simulate a server that never responds until the signal aborts.
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }) as unknown as Response;
        },
        () => uploadImage(bytes, "image/jpeg", "selfie.jpg", { timeoutMs: 2_000 }),
      ),
    (err: unknown) => err instanceof YouCamError && err.code === "UploadTimeout",
  );
});

test("uploadImage reports a non-OK PUT as an upload failure", async () => {
  await assert.rejects(
    () =>
      withStubbedFetch(
        (url) =>
          url.includes("/s2s/v2.0/file")
            ? new Response(JSON.stringify(CREATE_RESPONSE), { status: 200 })
            : new Response("nope", { status: 500 }),
        () => uploadImage(bytes, "image/jpeg", "selfie.jpg"),
      ),
    (err: unknown) => err instanceof YouCamError && err.code === "UploadFailed",
  );
});
