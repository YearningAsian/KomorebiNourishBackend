-- Diary rows from the phones could not fit this table: it had no place for the food's
-- name, water, sugar, sodium or the log time, and food_id pointed at server foods,
-- while foods stay on the device. A backed-up row must stand on its own, so food_id is
-- now only the phone's id for the food. unit is nullable because a row copied from a
-- meal plan has none on the phone either.
-- Columns match the client payload exactly, because the route spreads it into the row.
-- Written, not applied: review before `supabase db push`.
ALTER TABLE diary_entries DROP CONSTRAINT IF EXISTS diary_entries_food_id_fkey;
ALTER TABLE diary_entries ALTER COLUMN unit DROP NOT NULL;
ALTER TABLE diary_entries
  ADD COLUMN IF NOT EXISTS food_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS sugar_g DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS sodium_mg DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS is_water BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS water_ml DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logged_at BIGINT;
