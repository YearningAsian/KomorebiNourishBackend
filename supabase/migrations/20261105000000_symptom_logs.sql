-- B11: symptom logs (T8.4) back up to the server. The phones push them through
-- POST /v1/mutations (entity_type symptom_log); nothing reads them back yet.
-- Columns match the client payload exactly, because the route spreads it into the row.
-- Written, not applied: review before `supabase db push`.
CREATE TABLE IF NOT EXISTS symptom_logs (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  logged_at  BIGINT NOT NULL,
  note       TEXT CHECK (char_length(note) <= 500),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_symptom_logs_user ON symptom_logs(user_id, logged_at);
ALTER TABLE symptom_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON symptom_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
