/**
 * Token proxy for WHO's Embedded Coding Tool (ECT).
 *
 * The ECT talks to WHO's cloud ICD-API (id.who.int), which needs an OAuth2 token. The client
 * credentials must not reach the browser (ECT docs: use `getNewTokenFunction()` to ask your own
 * backend), so this Worker keeps them as secrets, gets a token from WHO's token endpoint, caches
 * it until shortly before it expires and hands it to the app's origin only.
 *
 *   GET /token  ->  { "token": "<access token>" }
 *
 * The Worker entry is `index.ts`: workerd accepts only handlers as its module's exports.
 */

export interface Env {
  ICD_CLIENT_ID: string;
  ICD_CLIENT_SECRET: string;
  /** Comma-separated origins allowed to fetch a token (wrangler.toml: production in [vars], dev in [env.dev]). */
  ALLOWED_ORIGINS: string;
  /** Workers rate-limit binding (`[[ratelimits]]` in wrangler.toml). */
  LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export const TOKEN_URL = "https://icdaccessmanagement.who.int/connect/token";
/** Ask for a new token this long before the current one expires (at most half its lifetime). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** A stalled WHO endpoint must not hold the request. */
const TOKEN_TIMEOUT_MS = 10_000;

/**
 * Fetches and caches WHO tokens. A miss asks WHO within the request that needs the token: Workers
 * does not let a request wait on I/O another request started, so concurrent misses (only when the
 * cached token is due) each ask. A failure is not cached.
 */
export class TokenCache {
  private cached?: { token: string; refreshAt: number; expiresAt: number };

  constructor(private readonly env: Pick<Env, "ICD_CLIENT_ID" | "ICD_CLIENT_SECRET">) {}

  async get(): Promise<string> {
    const cached = this.cached;
    if (cached && Date.now() < cached.refreshAt) return cached.token;
    try {
      return await this.request();
    } catch (e) {
      // WHO failing while the cached token is due but not expired: it still works until then.
      if (cached && Date.now() < cached.expiresAt) return cached.token;
      throw e;
    }
  }

  private async request(): Promise<string> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.env.ICD_CLIENT_ID,
        client_secret: this.env.ICD_CLIENT_SECRET,
        scope: "icdapi_access",
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`WHO token endpoint: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("WHO token endpoint: no access_token");
    const lifetime = (body.expires_in ?? 3600) * 1000;
    const now = Date.now();
    this.cached = { token: body.access_token, refreshAt: now + lifetime - Math.min(REFRESH_MARGIN_MS, lifetime / 2), expiresAt: now + lifetime };
    return this.cached.token;
  }
}

/** CORS headers for an allowed origin; null when the origin is not allowed. */
function corsFor(origin: string | null, allowed: string): Record<string, string> | null {
  if (!origin || !allowed.split(",").map((o) => o.trim()).includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function handle(req: Request, env: Env, tokens: TokenCache): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== "/token") return new Response("Not found", { status: 404 });
  const cors = corsFor(req.headers.get("Origin"), env.ALLOWED_ORIGINS);
  if (!cors) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });
  // Cloudflare's edge always sets CF-Connecting-IP; without it (tests, local tools) there is no
  // per-client key, and one shared key would let one caller block everyone.
  const ip = req.headers.get("CF-Connecting-IP");
  if (env.LIMITER && ip && !(await env.LIMITER.limit({ key: ip })).success) {
    return new Response("Too many requests", { status: 429, headers: cors });
  }
  try {
    const token = await tokens.get();
    return Response.json({ token }, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("token:", e); // visible in `wrangler tail`
    return new Response("WHO token unavailable", { status: 502, headers: cors });
  }
}
