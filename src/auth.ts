import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import type { AppEnv } from "./env";
import { isUuid } from "./shared";

/**
 * Verifies the Supabase access token and exposes the user id as `userId`.
 * Every /v1 route requires it.
 *
 * Claim checks (defense in depth — only real user access tokens pass):
 * - alg pinned to HS256 (header mismatch rejects; no alg:none / RS confusion)
 * - iss must be `<SUPABASE_URL>/auth/v1` and aud must be `authenticated`
 *   (anonymous sign-ins also carry aud `authenticated`); this rejects any
 *   other HS256 artifact signed with the same secret. If the project ever
 *   moves to a custom auth domain, keep SUPABASE_URL in sync with the issuer.
 * - exp must be present and unexpired (hono/jwt skips exp when the claim is
 *   absent, so missing-exp is rejected explicitly)
 * - sub must be a UUID — the auth.users id every query is scoped by
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return c.json({ message: "Missing bearer token" }, 401);
  }

  try {
    const payload = await verify(token, c.env.SUPABASE_JWT_SECRET, {
      alg: "HS256",
      iss: `${c.env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`,
      aud: "authenticated",
    });
    if (!isUuid(payload.sub) || typeof payload.exp !== "number") {
      return c.json({ message: "Invalid token" }, 401);
    }
    c.set("userId", payload.sub);
  } catch {
    return c.json({ message: "Invalid token" }, 401);
  }

  await next();
};
