import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";

/**
 * Per-user fixed-window rate limiting backed by Upstash Redis (REST API).
 *
 * Applied to abuse-sensitive routes (mutations drain, account deletion).
 * Keyed by the verified JWT user id, so it must run AFTER `requireUser`.
 *
 * Fail-open by design: if `UPSTASH_REDIS_REST_URL` / `..._TOKEN` are not
 * configured, the middleware is a no-op. This keeps local dev and pre-Upstash
 * deploys working; once the two secrets are set, limiting turns on with no
 * code change. A transient Redis error also fails open (availability over a
 * hard block) but is logged. This applies to the destructive /account route
 * too — a deliberate call: account deletion is a store-compliance flow that
 * must stay available, and it only ever touches the verified caller's own data.
 */

const ENABLED_HEADER = "x-ratelimit-limit";

type Options = {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Stable label for the bucket, e.g. "mutations". Keeps routes independent. */
  bucket: string;
};

type UpstashConfig = { url: string; token: string };

function upstashConfig(env: AppEnv["Bindings"]): UpstashConfig | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (typeof url !== "string" || url.length === 0) return null;
  if (typeof token !== "string" || token.length === 0) return null;
  return { url, token };
}

/**
 * Run an atomic INCR + (conditional) EXPIRE via the Upstash pipeline endpoint.
 * Returns the post-increment count and the seconds left on the window, or
 * `null` if Redis is unreachable / errors (caller fails open).
 */
async function hit(
  config: UpstashConfig,
  key: string,
  windowSeconds: number,
): Promise<{ count: number; ttl: number } | null> {
  try {
    const res = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, windowSeconds, "NX"],
        ["TTL", key],
      ]),
    });
    if (!res.ok) return null;

    const parsed: unknown = await res.json();
    if (!Array.isArray(parsed) || parsed.length < 3) return null;

    const count = asResult(parsed[0]);
    const ttl = asResult(parsed[2]);
    if (count === null) return null;

    return { count, ttl: ttl ?? windowSeconds };
  } catch {
    return null;
  }
}

/** Upstash pipeline items are `{ result }` or `{ error }`; extract a number. */
function asResult(item: unknown): number | null {
  if (item === null || typeof item !== "object") return null;
  const value = (item as { result?: unknown }).result;
  return typeof value === "number" ? value : null;
}

export function rateLimit(options: Options): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const config = upstashConfig(c.env);
    if (!config) {
      // Not configured — fail open so dev / pre-Upstash deploys keep working.
      await next();
      return;
    }

    const userId = c.get("userId");
    const key = `rl:${options.bucket}:${userId}`;
    const result = await hit(config, key, options.windowSeconds);

    if (result === null) {
      // Redis unreachable — fail open, but log so it's visible in tail/Sentry.
      console.error(`rate limit backend unavailable for bucket ${options.bucket}`);
      await next();
      return;
    }

    const remaining = Math.max(0, options.limit - result.count);
    c.header(ENABLED_HEADER, String(options.limit));
    c.header("x-ratelimit-remaining", String(remaining));

    if (result.count > options.limit) {
      c.header("retry-after", String(result.ttl));
      return c.json({ message: "Too many requests" }, 429);
    }

    await next();
  };
}
