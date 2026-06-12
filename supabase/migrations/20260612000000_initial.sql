-- Komorebi Nourish — initial Supabase schema
-- Derived from Room DB schema v5.
-- Timestamps: BIGINT epoch-ms (matches Room INTEGER affinity).
-- Booleans: BOOLEAN (Room stores as INTEGER 0/1 — Postgres stores natively).
-- user_id columns cascade-delete from auth.users.
-- food_logs carries a denormalized user_id for LWW ownership checks in the backend.
-- foods_fts (SQLite FTS4 virtual table) replaced by pg_trgm GIN index on foods.name/brand.

-- ============================================================
-- Extension needed for full-text / trigram search on foods
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- foods  (global catalog — user_id nullable for custom foods)
-- ============================================================
CREATE TABLE IF NOT EXISTS foods (
  id               TEXT PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  brand            TEXT,
  barcode          TEXT,
  calories_per_100g DOUBLE PRECISION,
  protein_per_100g  DOUBLE PRECISION,
  carbs_per_100g    DOUBLE PRECISION,
  fat_per_100g      DOUBLE PRECISION,
  fiber_per_100g    DOUBLE PRECISION,
  serving_size      DOUBLE PRECISION,
  serving_unit      TEXT,
  source            TEXT NOT NULL DEFAULT 'off',
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_foods_barcode       ON foods(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_foods_user_id       ON foods(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_foods_name_trgm     ON foods USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_foods_brand_trgm    ON foods USING GIN (brand gin_trgm_ops) WHERE brand IS NOT NULL;
ALTER TABLE foods ENABLE ROW LEVEL SECURITY;
-- All authenticated users can read global foods; write only to own custom foods.
CREATE POLICY "read_all" ON foods FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "write_own" ON foods FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own" ON foods FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "delete_own" ON foods FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- diary_entries  (main per-meal food log synced via mutations)
-- ============================================================
CREATE TABLE IF NOT EXISTS diary_entries (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id     TEXT REFERENCES foods(id) ON DELETE RESTRICT,
  date        TEXT NOT NULL,
  meal_type   TEXT NOT NULL,
  quantity    DOUBLE PRECISION NOT NULL,
  unit        TEXT NOT NULL,
  calories    DOUBLE PRECISION,
  protein_g   DOUBLE PRECISION,
  carbs_g     DOUBLE PRECISION,
  fat_g       DOUBLE PRECISION,
  fiber_g     DOUBLE PRECISION,
  note        TEXT,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  deleted_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_diary_entries_user_date ON diary_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_diary_entries_updated   ON diary_entries(user_id, updated_at);
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON diary_entries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- nutrition_goals  (one row per user)
-- ============================================================
CREATE TABLE IF NOT EXISTS nutrition_goals (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  calories   DOUBLE PRECISION,
  protein_g  DOUBLE PRECISION,
  carbs_g    DOUBLE PRECISION,
  fat_g      DOUBLE PRECISION,
  fiber_g    DOUBLE PRECISION,
  water_ml   DOUBLE PRECISION,
  updated_at BIGINT NOT NULL
);
ALTER TABLE nutrition_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON nutrition_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- water_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS water_logs (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_ml   DOUBLE PRECISION NOT NULL,
  logged_at   BIGINT NOT NULL,
  note        TEXT,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  deleted_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_water_logs_user ON water_logs(user_id, logged_at);
ALTER TABLE water_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON water_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- scan_jobs  (AI scan tracking; status checked by client polling)
-- ============================================================
CREATE TABLE IF NOT EXISTS scan_jobs (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  result_json TEXT,
  error       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_user_status ON scan_jobs(user_id, status);
ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON scan_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- recent_foods
-- ============================================================
CREATE TABLE IF NOT EXISTS recent_foods (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id      TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  last_used_at BIGINT NOT NULL,
  use_count    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, food_id)
);
ALTER TABLE recent_foods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON recent_foods
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- nourish_settings  (one row per user)
-- ============================================================
CREATE TABLE IF NOT EXISTS nourish_settings (
  user_id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  units_preference         TEXT NOT NULL DEFAULT 'metric',
  meal_reminders_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  morning_reminder_time    TEXT,
  evening_reminder_time    TEXT,
  show_macros              BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_report_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  sync_status              TEXT NOT NULL DEFAULT 'synced',
  updated_at               BIGINT NOT NULL
);
ALTER TABLE nourish_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON nourish_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- saved_meals
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_meals (
  id               TEXT PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  total_calories   DOUBLE PRECISION,
  total_protein_g  DOUBLE PRECISION,
  total_carbs_g    DOUBLE PRECISION,
  total_fat_g      DOUBLE PRECISION,
  sync_status      TEXT NOT NULL DEFAULT 'synced',
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL,
  deleted_at       BIGINT
);
CREATE INDEX IF NOT EXISTS idx_saved_meals_user ON saved_meals(user_id);
ALTER TABLE saved_meals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON saved_meals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- saved_meal_items  (join table — no direct user_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_meal_items (
  id        TEXT PRIMARY KEY,
  meal_id   TEXT NOT NULL REFERENCES saved_meals(id) ON DELETE CASCADE,
  food_id   TEXT REFERENCES foods(id) ON DELETE SET NULL,
  food_name TEXT NOT NULL,
  quantity  DOUBLE PRECISION NOT NULL,
  unit      TEXT NOT NULL,
  calories  DOUBLE PRECISION,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_saved_meal_items_meal ON saved_meal_items(meal_id);
ALTER TABLE saved_meal_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON saved_meal_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM saved_meals WHERE saved_meals.id = saved_meal_items.meal_id AND saved_meals.user_id = auth.uid())
  );

-- ============================================================
-- meal_plans
-- ============================================================
CREATE TABLE IF NOT EXISTS meal_plans (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  deleted_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_meal_plans_user ON meal_plans(user_id, start_date);
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON meal_plans
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- meal_plan_days  (no direct user_id — scoped via meal_plans)
-- ============================================================
CREATE TABLE IF NOT EXISTS meal_plan_days (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  day_number      INTEGER NOT NULL,
  target_calories DOUBLE PRECISION,
  UNIQUE (plan_id, day_number)
);
CREATE INDEX IF NOT EXISTS idx_meal_plan_days_plan ON meal_plan_days(plan_id);
ALTER TABLE meal_plan_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON meal_plan_days
  FOR ALL USING (
    EXISTS (SELECT 1 FROM meal_plans WHERE meal_plans.id = meal_plan_days.plan_id AND meal_plans.user_id = auth.uid())
  );

-- ============================================================
-- meal_plan_entries  (no direct user_id — scoped via meal_plan_days)
-- ============================================================
CREATE TABLE IF NOT EXISTS meal_plan_entries (
  id         TEXT PRIMARY KEY,
  day_id     TEXT NOT NULL REFERENCES meal_plan_days(id) ON DELETE CASCADE,
  food_id    TEXT REFERENCES foods(id) ON DELETE SET NULL,
  food_name  TEXT NOT NULL,
  meal_type  TEXT NOT NULL,
  quantity   DOUBLE PRECISION NOT NULL,
  unit       TEXT NOT NULL,
  calories   DOUBLE PRECISION,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_day ON meal_plan_entries(day_id);
ALTER TABLE meal_plan_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON meal_plan_entries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM meal_plan_days mpd
      JOIN meal_plans mp ON mp.id = mpd.plan_id
      WHERE mpd.id = meal_plan_entries.day_id AND mp.user_id = auth.uid()
    )
  );

-- ============================================================
-- body_measurements
-- ============================================================
CREATE TABLE IF NOT EXISTS body_measurements (
  id             TEXT PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weight_kg      DOUBLE PRECISION,
  body_fat_pct   DOUBLE PRECISION,
  muscle_mass_kg DOUBLE PRECISION,
  bmi            DOUBLE PRECISION,
  waist_cm       DOUBLE PRECISION,
  measured_at    BIGINT NOT NULL,
  note           TEXT,
  sync_status    TEXT NOT NULL DEFAULT 'synced',
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  deleted_at     BIGINT
);
CREATE INDEX IF NOT EXISTS idx_body_measurements_user ON body_measurements(user_id, measured_at);
ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON body_measurements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- nutrition_trends_cache  (server-computed; no sync_status)
-- ============================================================
CREATE TABLE IF NOT EXISTS nutrition_trends_cache (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trends_json  TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  updated_at   BIGINT NOT NULL
);
ALTER TABLE nutrition_trends_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON nutrition_trends_cache
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- food_logs  (AI scan result containers; user_id denormalized for LWW)
-- Room v5 has no user_id on this table — added here for sync ownership checks.
-- ============================================================
CREATE TABLE IF NOT EXISTS food_logs (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_at  BIGINT NOT NULL,
  meal_type  TEXT NOT NULL,
  source     TEXT NOT NULL,
  deleted_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_food_logs_user ON food_logs(user_id, logged_at);
ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON food_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- food_items  (individual items within a food_log)
-- ============================================================
CREATE TABLE IF NOT EXISTS food_items (
  id          TEXT PRIMARY KEY,
  log_id      TEXT NOT NULL REFERENCES food_logs(id) ON DELETE CASCADE,
  food_id     TEXT REFERENCES foods(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  quantity    DOUBLE PRECISION NOT NULL,
  unit        TEXT NOT NULL,
  calories    DOUBLE PRECISION,
  protein_g   DOUBLE PRECISION,
  carbs_g     DOUBLE PRECISION,
  fat_g       DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_food_items_log ON food_items(log_id);
ALTER TABLE food_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON food_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM food_logs WHERE food_logs.id = food_items.log_id AND food_logs.user_id = auth.uid())
  );

-- ============================================================
-- nutrients  (micro-nutrients per food_item)
-- ============================================================
CREATE TABLE IF NOT EXISTS nutrients (
  id           TEXT PRIMARY KEY,
  food_item_id TEXT NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  amount       DOUBLE PRECISION NOT NULL,
  unit         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nutrients_food_item ON nutrients(food_item_id);
ALTER TABLE nutrients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON nutrients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM food_items fi
      JOIN food_logs fl ON fl.id = fi.log_id
      WHERE fi.id = nutrients.food_item_id AND fl.user_id = auth.uid()
    )
  );

-- ============================================================
-- device_tokens  (push notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_tokens (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL CHECK (platform IN ('apns', 'android', 'fcm')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, token)
);
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON device_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
