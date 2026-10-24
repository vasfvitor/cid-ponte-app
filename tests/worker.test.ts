import { afterEach, describe, expect, it, vi } from "vitest";

import { TOKEN_URL, TokenCache, handle, type Env } from "../worker/src/proxy";

const APP = "http://localhost:5199";
const env: Env = { ICD_CLIENT_ID: "id", ICD_CLIENT_SECRET: "secret", ALLOWED_ORIGINS: `https://vasfvitor.github.io, ${APP}` };

const tokenResponse = (token: string): Response =>
  Response.json({ access_token: token, expires_in: 3600, token_type: "Bearer" });

/** A request to the Worker, from `origin` (none: no Origin header) and, as Cloudflare's edge sets it, a client IP. */
const req = (path: string, origin: string | null, method = "GET", ip?: string): Request =>
  new Request(`https://worker.test${path}`, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...(ip ? { "CF-Connecting-IP": ip } : {}) },
  });

/** Stub the global fetch the Worker calls; `reply` builds each response. */
function stubFetch(reply: (call: number) => Response) {
  let calls = 0;
  const fetchFn = vi.fn<typeof fetch>(async () => reply(++calls));
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TokenCache", () => {
  it("asks WHO with client credentials and reuses the token until near expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchFn = stubFetch((n) => tokenResponse(`t${n}`));
    const cache = new TokenCache(env);

    expect(await cache.get()).toBe("t1");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(TOKEN_URL);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("icdapi_access");

    vi.setSystemTime(50 * 60 * 1000); // 50 min: still valid
    expect(await cache.get()).toBe("t1");
    vi.setSystemTime(56 * 60 * 1000); // within 5 min of expiry: refresh
    expect(await cache.get()).toBe("t2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure", async () => {
    const fetchFn = stubFetch((n) => (n === 1 ? new Response("no", { status: 401 }) : tokenResponse("ok")));
    const cache = new TokenCache(env);
    await expect(cache.get()).rejects.toThrow("HTTP 401");
    expect(await cache.get()).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("keeps serving a due token while WHO fails, until the token expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    stubFetch((n) => (n === 1 ? tokenResponse("t1") : new Response("", { status: 503 })));
    const cache = new TokenCache(env);
    expect(await cache.get()).toBe("t1");
    vi.setSystemTime(57 * 60 * 1000); // due for refresh, WHO down: the old one still works
    expect(await cache.get()).toBe("t1");
    vi.setSystemTime(61 * 60 * 1000); // expired
    await expect(cache.get()).rejects.toThrow("HTTP 503");
  });

  it("still caches when WHO gives 5 min or less (margin capped at half the lifetime)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchFn = stubFetch(() => Response.json({ access_token: "short", expires_in: 300 }));
    const cache = new TokenCache(env);
    await cache.get();
    vi.setSystemTime(60 * 1000);
    await cache.get();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("handle", () => {
  it("returns the token to an allowed origin, never cached", async () => {
    stubFetch(() => tokenResponse("abc"));
    const res = await handle(req("/token", APP), env, new TokenCache(env));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "abc" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers the CORS preflight", async () => {
    expect((await handle(req("/token", APP, "OPTIONS"), env, new TokenCache(env))).status).toBe(204);
  });

  it("refuses other origins, paths and methods", async () => {
    const tokens = new TokenCache(env);
    expect((await handle(req("/token", "https://evil.example"), env, tokens)).status).toBe(403);
    expect((await handle(req("/token", null), env, tokens)).status).toBe(403);
    expect((await handle(req("/other", APP), env, tokens)).status).toBe(404);
    expect((await handle(req("/token", APP, "POST"), env, tokens)).status).toBe(405);
  });

  it("answers 429 when the rate limit is hit", async () => {
    const limited: Env = { ...env, LIMITER: { limit: async () => ({ success: false }) } };
    expect((await handle(req("/token", APP, "GET", "203.0.113.1"), limited, new TokenCache(env))).status).toBe(429);
  });

  it("limits per CF-Connecting-IP, and skips the limit without it", async () => {
    stubFetch(() => tokenResponse("abc"));
    const keys: string[] = [];
    const limited: Env = { ...env, LIMITER: { limit: async ({ key }) => (keys.push(key), { success: true }) } };
    const tokens = new TokenCache(env);
    expect((await handle(req("/token", APP, "GET", "203.0.113.1"), limited, tokens)).status).toBe(200);
    expect((await handle(req("/token", APP), limited, tokens)).status).toBe(200);
    expect(keys).toEqual(["203.0.113.1"]);
  });

  it("reports WHO failures as 502", async () => {
    stubFetch(() => new Response("", { status: 500 }));
    expect((await handle(req("/token", APP), env, new TokenCache(env))).status).toBe(502);
  });
});
