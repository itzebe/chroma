/**
 * Shared stub transport for route-level tests.
 *
 * Route handlers are driven for real with real `Request` objects; only the
 * network is replaced. `globalThis.fetch` is intercepted for both the YouCam
 * API and the Upstash REST endpoint, so tests can assert exactly which outbound
 * calls a request caused - the point being to prove that invalid requests make
 * NONE, and that valid ones make the right ones.
 */

export interface StubCall {
  url: string;
  method: string;
  body: string | undefined;
}

export interface RedisBehaviour {
  mode?: "ok" | "down";
  /** Result the reserve/settle Lua script should return. */
  evalResult?: unknown;
}

export interface StubOptions {
  fileId?: string;
  /** Return a custom YouCam response, or undefined to use the default flow. */
  youcam?: (url: string, init: RequestInit) => Response | undefined;
  redis?: RedisBehaviour;
  /** Skin-tone result the default flow returns. */
  skin?: Record<string, unknown>;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const DEFAULT_SKIN = {
  color: {
    skin_color: "#ba8e6e",
    lip_color: "#c98e93",
    eye_color: "#342724",
    eyebrow_color: "#3e3834",
  },
  face_quality: { has_face: true, area: "good", frontal: "good", lighting: "good", faceangle: "good" },
};

/** Install the stub. Call `restore()` in a `finally` or test teardown. */
export function installStub(opts: StubOptions = {}) {
  const original = globalThis.fetch;
  const calls: StubCall[] = [];
  const fileId = opts.fileId ?? "file-1";

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method as string) ?? "GET";
    calls.push({ url, method, body: init.body ? String(init.body) : undefined });

    if (url.includes("redis.test")) {
      if (opts.redis?.mode === "down") throw new Error("redis unreachable");
      const cmd = init.body ? (JSON.parse(String(init.body)) as unknown[]) : [];
      if (cmd[0] === "eval") return json({ result: opts.redis?.evalResult ?? [1, 20] });
      return json({ result: 1 });
    }

    const custom = opts.youcam?.(url, init);
    if (custom) return custom;

    if (url.includes("/s2s/v2.0/file")) {
      return json({
        status: 200,
        data: { files: [{ file_id: fileId, requests: [{ method: "PUT", url: "https://up.test/1", headers: {} }] }] },
      });
    }
    if (url.includes("/skin-tone-analysis") && method === "POST") return json({ status: 200, data: { task_id: "s1" } });
    if (url.includes("/skin-tone-analysis/s1")) {
      return json({ status: 200, data: { task_status: "success", results: opts.skin ?? DEFAULT_SKIN } });
    }
    if (url.includes("/makeup-vto") && method === "POST") return json({ status: 200, data: { task_id: "t1" } });
    if (url.includes("/makeup-vto/t1")) {
      return json({ status: 200, data: { task_status: "success", results: { url: "https://cdn.test/out.png" } } });
    }
    return json({});
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
    /** Outbound calls to the paid YouCam endpoints. */
    paidCalls: () => calls.filter((c) => c.url.includes("/task/") || c.url.includes("/s2s/v2.0/file")),
  };
}

/** Configure the environment the security modules read. */
export function setSecurityEnv(overrides: Record<string, string | undefined> = {}) {
  process.env.YOUCAM_API_KEY = "test-key";
  process.env.YOUCAM_API_BASE_URL = "https://api.example.test";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  process.env.CHROMA_TICKET_SECRET = "test-ticket-secret-0123456789";
  process.env.CHROMA_RATE_LIMIT_PER_MIN = "1000";
  process.env.CHROMA_DAILY_UNIT_CEILING = "1000000";
  process.env.YOUCAM_POLL_INTERVAL_MS = "1";
  delete process.env.CHROMA_API_TOKEN;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  // The budget store caches its client, so re-resolve it for the new environment.
  budgetStoreModule?.resetBudgetStoreCache();
}

/** Lazily imported so this helper stays usable before the module is loaded. */
let budgetStoreModule: { resetBudgetStoreCache: () => void } | undefined;
export async function primeSecurityEnv(): Promise<void> {
  budgetStoreModule = (await import("../../src/lib/security/budget.ts")) as {
    resetBudgetStoreCache: () => void;
  };
}

/** A POST `Request` that looks same-origin to the guard. */
export function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.test", ...headers },
    body: JSON.stringify(body),
  });
}

/** A multipart POST with a single image file. */
export function postFile(path: string, bytes: Uint8Array, type = "image/jpeg", name = "selfie.jpg"): Request {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request(`https://app.test${path}`, { method: "POST", headers: { host: "app.test" }, body: form });
}
