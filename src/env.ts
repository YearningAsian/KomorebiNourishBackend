export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  // Optional — when both are set, abuse-sensitive routes are rate limited via
  // Upstash Redis. Absent ⇒ rate limiting is a no-op (fail open). See rateLimit.ts.
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

export type Variables = {
  userId: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
