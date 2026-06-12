import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Bindings } from "./env";

/**
 * Service-role client — bypasses RLS, so EVERY query in this codebase must
 * filter by the authenticated user id from the JWT. Never expose this key.
 *
 * Cached at module scope: the client is a stateless fetch wrapper (no
 * sessions, no held sockets), and bindings are constant for an isolate's
 * lifetime, so rebuilding it on every call is pure per-request overhead.
 * The binding comparison guards against secret rotation between requests.
 */
let cached: { url: string; key: string; client: SupabaseClient } | null = null;

export function adminClient(env: Bindings): SupabaseClient {
  if (
    cached &&
    cached.url === env.SUPABASE_URL &&
    cached.key === env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return cached.client;
  }
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cached = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, client };
  return client;
}
