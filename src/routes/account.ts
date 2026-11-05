import { Hono } from "hono";
import type { AppEnv } from "../env";
import { adminClient } from "../supabaseAdmin";

/**
 * DELETE /v1/account — permanent account deletion, called by the in-app
 * "Delete account & data" flow (Apple 5.1.1(v) / Play User Data policy).
 * Explicitly deletes the user's rows, then the auth user (FKs cascade as a
 * backstop). Identity comes from the verified JWT only.
 */
export const account = new Hono<AppEnv>();

account.delete("/", async (c) => {
  const userId = c.get("userId");
  const db = adminClient(c.env);

  // Delete top-level tables that carry user_id directly; FK cascades (ON DELETE
  // CASCADE to auth.users) handle any join tables not listed here.
  // Order: leaf tables before parents to avoid FK violations on projects
  // that don't have cascades wired up yet.
  const TABLES = [
    "device_tokens",
    "nourish_settings",
    "nutrition_trends_cache",
    "scan_jobs",
    "body_measurements",
    "meal_plans",
    "saved_meals",
    "water_logs",
    "nutrition_goals",
    "recent_foods",
    "food_logs",
    "diary_entries",
    "symptom_logs",
  ] as const;

  for (const table of TABLES) {
    const { error } = await db.from(table).delete().eq("user_id", userId);
    if (error) {
      return c.json({ message: `Failed to delete ${table}` }, 500);
    }
  }

  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (authError) {
    return c.json({ message: "Failed to delete auth user" }, 500);
  }

  return c.json({ status: "deleted" });
});
