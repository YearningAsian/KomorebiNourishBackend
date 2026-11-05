import { Hono } from "hono";
import type { AppEnv } from "../env";
import { adminClient } from "../supabaseAdmin";
import { asEpochMs, isUuid } from "../shared";

/**
 * POST /v1/mutations — the offline-first sync drain target.
 * Body (snake_case): { entity_type, entity_id, operation, payload }
 * where payload is a JSON string snapshot of the entity.
 *
 * Conflict policy: last-write-wins on updated_at; a stale write returns 409,
 * which the client records as a conflict (and auto-resolves to keep-remote).
 *
 * entity_type → Supabase table:
 *   diary_entry → diary_entries
 *   food_log    → food_logs
 *   symptom_log → symptom_logs
 */
export const mutations = new Hono<AppEnv>();

const ENTITY_TABLES: Record<string, string> = {
  diary_entry: "diary_entries",
  food_log: "food_logs",
  symptom_log: "symptom_logs",
};

type MutationBody = {
  entity_type?: unknown;
  entity_id?: unknown;
  operation?: unknown;
  payload?: unknown;
};

const MAX_PAYLOAD = 64_000;

mutations.post("/", async (c) => {
  const body = await c.req.json<MutationBody>().catch(() => null);
  if (!body) return c.json({ message: "Invalid JSON" }, 400);

  const entityType = body.entity_type;
  const entityId = body.entity_id;
  const operation = body.operation;

  const table =
    typeof entityType === "string" ? ENTITY_TABLES[entityType] : undefined;
  if (
    !table ||
    !isUuid(entityId) ||
    (operation !== "create" && operation !== "update" && operation !== "delete")
  ) {
    return c.json({ message: "Invalid mutation" }, 400);
  }

  if (typeof body.payload === "string" && body.payload.length > MAX_PAYLOAD) {
    return c.json({ message: "Payload too large" }, 400);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(
      typeof body.payload === "string" ? body.payload : "{}",
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return c.json({ message: "Invalid payload" }, 400);
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return c.json({ message: "Invalid payload" }, 400);
  }

  const userId = c.get("userId");
  const db = adminClient(c.env);

  if (operation === "delete") {
    const deletedAt = asEpochMs(payload["deleted_at"]) ?? Date.now();
    const { error } = await db
      .from(table)
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq("id", entityId)
      .eq("user_id", userId);
    if (error) return c.json({ message: "Delete failed" }, 500);
    return c.json({ id: entityId, status: "applied" });
  }

  // create / update
  if (payload["id"] !== undefined && payload["id"] !== entityId) {
    return c.json({ message: "Payload id mismatch" }, 400);
  }
  const createdAt = asEpochMs(payload["created_at"]);
  const updatedAt = asEpochMs(payload["updated_at"]);
  if (createdAt === null || updatedAt === null) {
    return c.json({ message: "Missing timestamps" }, 400);
  }
  const deletedAt = asEpochMs(payload["deleted_at"]);

  // Build the row: spread the client payload, then override security-sensitive
  // fields (id, user_id, timestamps) so the client can never forge ownership.
  const row: Record<string, unknown> = {
    ...payload,
    id: entityId,
    user_id: userId,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: deletedAt,
  };

  // Last-write-wins: reject stale writes so the client records a conflict.
  const { data: existing, error: readError } = await db
    .from(table)
    .select("user_id, updated_at")
    .eq("id", entityId)
    .maybeSingle<{ user_id: string; updated_at: number }>();
  if (readError) return c.json({ message: "Lookup failed" }, 500);
  if (existing && existing.user_id !== userId) {
    return c.json({ message: "Conflict" }, 409);
  }
  if (existing && existing.updated_at > updatedAt) {
    return c.json({ message: "Remote is newer" }, 409);
  }

  if (existing) {
    const { data: updated, error: updateError } = await db
      .from(table)
      .update(row)
      .eq("id", entityId)
      .eq("user_id", userId)
      .lte("updated_at", updatedAt)
      .select("id");
    if (updateError) return c.json({ message: "Write failed" }, 500);
    if (!updated || updated.length === 0) {
      return c.json({ message: "Remote is newer" }, 409);
    }
  } else {
    const { error: insertError } = await db.from(table).insert(row);
    if (insertError) {
      if (insertError.code === "23505") {
        return c.json({ message: "Conflict" }, 409);
      }
      return c.json({ message: "Write failed" }, 500);
    }
  }

  return c.json({ id: entityId, status: "applied" });
});
