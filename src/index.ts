import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireUser } from "./auth";
import { rateLimit } from "./rateLimit";
import { account } from "./routes/account";
import { devices } from "./routes/devices";
import { foods } from "./routes/foods";
import { mutations } from "./routes/mutations";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true }));

const v1 = new Hono<AppEnv>();
v1.use("*", requireUser);

// Per-user rate limits on abuse-sensitive routes (no-op until Upstash secrets
// are set — see rateLimit.ts). Fail-OPEN even for /account: deletion is a
// store-compliance flow that must stay available, every route is already
// JWT-scoped to the caller's own data, and deletes are idempotent.
v1.use("/mutations/*", rateLimit({ bucket: "mutations", limit: 120, windowSeconds: 60 }));
v1.use("/account/*", rateLimit({ bucket: "account", limit: 5, windowSeconds: 3600 }));
// Food lookups: generous limit since barcode scans come from real user interaction.
v1.use("/foods/*", rateLimit({ bucket: "foods", limit: 300, windowSeconds: 60 }));

v1.route("/mutations", mutations);
v1.route("/devices", devices);
v1.route("/foods", foods);
v1.route("/account", account);

// AI scan / voice routes — 503 until ENABLE_AI_SCAN is flipped and backends wired.
v1.post("/scan/start", (c) => c.json({ message: "AI scan not yet available" }, 503));
v1.get("/scan/status/:jobId", (c) => c.json({ message: "AI scan not yet available" }, 503));
v1.post("/voice/log", (c) => c.json({ message: "AI voice log not yet available" }, 503));

app.route("/v1", v1);

app.notFound((c) => c.json({ message: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ message: "Internal error" }, 500);
});

export default app;
