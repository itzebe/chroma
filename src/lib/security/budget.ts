/**
 * Access control and paid-unit budgeting for the YouCam-backed routes.
 *
 * The app spends real money: a skin-tone analysis costs 20 units and a makeup
 * render costs 1. Three controls protect that budget, in this order:
 *
 *  1. Origin check  - a cheap same-origin guard against cross-site abuse.
 *  2. Authentication - optional shared token (`CHROMA_API_TOKEN`). Origin is a
 *     CSRF defence, never a substitute for authentication, so the two are kept
 *     separate and either can be required.
 *  3. Rate limit + global daily ceiling - both enforced in Redis (Upstash) with
 *     atomic Lua scripts, so concurrent instances cannot exceed the ceiling.
 *
 * Fail-closed policy: any request that may spend units is REFUSED when the
 * Redis budget store is missing or unreachable. Free (recorded-sample) requests
 * fall back to a best-effort in-memory limiter, because no money is at stake.
 *
 * Cost model: units are reserved before the upstream call and settled after it.
 * A reservation is a guess; the settle is the truth. Failed operations refund,
 * so a failure never decrements the budget, and a crash between the two leaves
 * the budget conservatively consumed rather than over-spent.
 */

import { Redis } from "@upstash/redis";

export type GuardCode =
  | "Forbidden"
  | "Unauthorized"
  | "RateLimited"
  | "BudgetExhausted"
  | "BudgetUnavailable";

export interface GuardFailure {
  ok: false;
  code: GuardCode;
  status: 401 | 403 | 429 | 503;
  title: string;
  message: string;
  guidance: string;
  retryable: boolean;
}

export interface GuardSuccess {
  ok: true;
  /** Call after the operation with whether units were actually spent. */
  settle: (charged: boolean) => Promise<void>;
}

export type GuardResult = GuardSuccess | GuardFailure;

export interface GuardOptions {
  request: Request;
  /** Units this operation costs when it succeeds. 0 for a free operation. */
  cost: number;
  /** True when the operation may call the paid upstream API. */
  willSpend: boolean;
}

const DAY_SECONDS = 86_400;
const GLOBAL_TTL_SECONDS = 2 * DAY_SECONDS; // outlives the day it counts
const WINDOW_MS = 60_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** UTC day key, so the ceiling resets on a predictable boundary. */
function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

let cached: Redis | null | undefined;

/** The shared Redis client, or null when the deployment is not configured. */
export function getBudgetStore(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    cached = null;
    return cached;
  }
  cached = new Redis({
    url,
    token,
    enableAutoPipelining: false,
    // A budget guard must fail fast: the default is 5 retries with exponential
    // backoff (~4s), which would burn function time before failing closed.
    retry: { retries: 1, backoff: () => 0 },
  });
  return cached;
}

/** Drop the cached client. Exported for tests that change the environment. */
export function resetBudgetStoreCache(): void {
  cached = undefined;
}

/** True when a distributed budget store is configured. */
export function budgetStoreConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function dailyUnitCeiling(): number {
  return envInt("CHROMA_DAILY_UNIT_CEILING", 2000);
}

export function rateLimitPerMinute(): number {
  return envInt("CHROMA_RATE_LIMIT_PER_MIN", 8);
}

/**
 * Atomically reserve rate-limit capacity and budget for one operation.
 *
 * The whole decision is a single Lua script, so two concurrent requests can
 * never both observe room under the ceiling. The per-IP counter is charged
 * first; the global ceiling is charged by the operation's true cost.
 */
const RESERVE_SCRIPT = `
local ipCount = redis.call('INCRBY', KEYS[1], 1)
if ipCount == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if ipCount > tonumber(ARGV[3]) then return {0, 'rate_limited'} end
local global = redis.call('INCRBY', KEYS[2], ARGV[4])
if global == tonumber(ARGV[4]) then redis.call('EXPIRE', KEYS[2], ARGV[6]) end
if global > tonumber(ARGV[5]) then
  redis.call('DECRBY', KEYS[2], ARGV[4])
  return {0, 'budget_exhausted'}
end
return {1, global}
`;

/** Adjust the global counter after the truth of an operation is known. */
const SETTLE_SCRIPT = `
local n = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if n < 0 then
  redis.call('SET', KEYS[1], 0, 'EX', ARGV[2])
  n = 0
end
return n
`;

/**
 * Best-effort client IP for the per-IP rate limit.
 *
 * On Vercel this is trustworthy: "we currently overwrite the X-Forwarded-For
 * header and do not forward external IPs. This restriction is in place to
 * prevent IP spoofing" (vercel.com/docs/headers/request-headers). The first
 * entry is therefore the real client, not a client-supplied value.
 *
 * On any other host, only trust these headers if a reverse proxy you control
 * overwrites them. If the host lets clients set them, the per-IP limit is
 * bypassable by spoofing — the global daily ceiling still holds, because it
 * does not depend on the IP.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const extra = (process.env.CHROMA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // A same-origin fetch may omit Origin on some GET-style requests; for POST the
  // browser always sends it. No Origin and no Referer means a non-browser client,
  // which must still pass authentication below.
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  if (host && originHost === host) return true;
  return extra.some((allowed) => {
    try {
      return new URL(allowed).host === originHost;
    } catch {
      return allowed === originHost;
    }
  });
}

function tokenAuthorised(request: Request): boolean {
  const expected = process.env.CHROMA_API_TOKEN;
  if (!expected) return true; // auth not configured: origin + rate limit still apply
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length !== expected.length) return false;
  // Constant-time compare: length is already equal, so a plain XOR fold is safe.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

const FREE_FALLBACK = new Map<string, number[]>();
/** Cap the map so a flood of distinct IPs cannot grow it without bound. */
const FREE_FALLBACK_MAX_IPS = 10_000;

/** Best-effort in-memory limiter, used ONLY for free operations without Redis. */
function freeFallbackLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (FREE_FALLBACK.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  // Re-inserting refreshes LRU order, so the eviction below drops the stalest.
  FREE_FALLBACK.delete(ip);
  FREE_FALLBACK.set(ip, recent);
  if (FREE_FALLBACK.size > FREE_FALLBACK_MAX_IPS) {
    const oldest = FREE_FALLBACK.keys().next().value;
    if (oldest !== undefined) FREE_FALLBACK.delete(oldest);
  }
  return recent.length > rateLimitPerMinute();
}

function failure(code: GuardCode): GuardFailure {
  switch (code) {
    case "Forbidden":
      return {
        ok: false,
        code,
        status: 403,
        title: "Request blocked",
        message: "This endpoint only accepts requests from the Chroma app itself.",
        guidance: "Open the app and try again from the interface.",
        retryable: false,
      };
    case "Unauthorized":
      return {
        ok: false,
        code,
        status: 401,
        title: "Authentication required",
        message: "This deployment requires a bearer token to use the analysis endpoints.",
        guidance: "Supply a valid token, or run the app without CHROMA_API_TOKEN set.",
        retryable: false,
      };
    case "RateLimited":
      return {
        ok: false,
        code,
        status: 429,
        title: "Too many requests",
        message: "You are analysing photos faster than this deployment allows.",
        guidance: "Wait a minute and try again.",
        retryable: true,
      };
    case "BudgetExhausted":
      return {
        ok: false,
        code,
        status: 429,
        title: "Daily analysis budget reached",
        message: "This deployment has spent its YouCam units for today, so it has stopped calling the API.",
        guidance: "Try again after midnight UTC, or use the recorded sample, which costs no units.",
        retryable: true,
      };
    case "BudgetUnavailable":
      return {
        ok: false,
        code,
        status: 503,
        title: "Analysis is temporarily unavailable",
        message: "The spending guard that protects the YouCam account is not reachable, so live analysis is paused.",
        guidance: "Try again shortly. The recorded sample still works and costs no units.",
        retryable: true,
      };
  }
}

/**
 * Cheap access check (origin + authentication). Needs no Redis, so it can run
 * before a request body is read, and it is the part that stops cross-site and
 * unauthenticated traffic early.
 */
export function checkAccess(request: Request): GuardFailure | null {
  if (!originAllowed(request)) return failure("Forbidden");
  if (!tokenAuthorised(request)) return failure("Unauthorized");
  return null;
}

/**
 * Authorise one request and reserve its budget. Returns a handle whose `settle`
 * must be called exactly once with whether units were truly spent.
 */
export async function guardRequest(opts: GuardOptions): Promise<GuardResult> {
  const { request, cost, willSpend } = opts;

  const access = checkAccess(request);
  if (access) return access;

  const ip = clientIp(request);
  const redis = getBudgetStore();

  // Free operations: never fail closed, they cost nothing.
  if (!willSpend || cost <= 0) {
    if (!redis) {
      if (freeFallbackLimited(ip)) return failure("RateLimited");
      return { ok: true, settle: async () => {} };
    }
    try {
      const result = (await redis.eval(
        RESERVE_SCRIPT,
        [`chroma:rl:${ip}`, `chroma:units:${dayKey()}`],
        [Date.now(), WINDOW_MS, rateLimitPerMinute(), 0, dailyUnitCeiling(), GLOBAL_TTL_SECONDS],
      )) as [number, string];
      if (!Array.isArray(result) || result[0] !== 1) {
        return failure(result?.[1] === "budget_exhausted" ? "BudgetExhausted" : "RateLimited");
      }
    } catch {
      // Redis was reachable enough to try but failed: fall back, nothing at stake.
      if (freeFallbackLimited(ip)) return failure("RateLimited");
    }
    return { ok: true, settle: async () => {} };
  }

  // Spending operations: no distributed store means fail closed.
  if (!redis) return failure("BudgetUnavailable");

  let reserved: [number, string];
  try {
    reserved = (await redis.eval(
      RESERVE_SCRIPT,
      [`chroma:rl:${ip}`, `chroma:units:${dayKey()}`],
      [Date.now(), WINDOW_MS, rateLimitPerMinute(), cost, dailyUnitCeiling(), GLOBAL_TTL_SECONDS],
    )) as [number, string];
  } catch {
    return failure("BudgetUnavailable");
  }

  if (!Array.isArray(reserved) || reserved[0] !== 1) {
    return failure(reserved?.[1] === "budget_exhausted" ? "BudgetExhausted" : "RateLimited");
  }

  const key = `chroma:units:${dayKey()}`;
  let settled = false;
  return {
    ok: true,
    settle: async (charged: boolean) => {
      if (settled) return;
      settled = true;
      if (charged) return; // the reservation was accurate
      try {
        await redis.eval(SETTLE_SCRIPT, [key], [-cost, GLOBAL_TTL_SECONDS]);
      } catch {
        // Refund failed: the budget stays conservatively consumed. Never throw
        // here, or a successful operation would be reported as a failure.
      }
    },
  };
}
