import { Hono } from "hono";
import type { AppEnv } from "../env";
import { adminClient } from "../supabaseAdmin";

export const devices = new Hono<AppEnv>();

/** POST /v1/devices/tokens — register a push token for reminders. */
devices.post("/tokens", async (c) => {
  const body = await c.req
    .json<{ token?: unknown; platform?: unknown }>()
    .catch(() => null);
  const token = body?.token;
  const platform = body?.platform;
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 4096 ||
    (platform !== "apns" && platform !== "android" && platform !== "fcm")
  ) {
    return c.json({ message: "Invalid token registration" }, 400);
  }

  const db = adminClient(c.env);
  const { error } = await db.from("device_tokens").upsert({
    user_id: c.get("userId"),
    token,
    platform,
    updated_at: new Date().toISOString(),
  });
  if (error) return c.json({ message: "Write failed" }, 500);

  return c.json({ id: token });
});

/** DELETE /v1/devices/tokens/:token — unregister a push token (logout). */
devices.delete("/tokens/:token", async (c) => {
  const token = c.req.param("token");
  const db = adminClient(c.env);
  const { error } = await db
    .from("device_tokens")
    .delete()
    .eq("user_id", c.get("userId"))
    .eq("token", token);
  if (error) return c.json({ message: "Delete failed" }, 500);
  return c.json({ status: "deleted" });
});
