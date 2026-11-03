-- Day anchors (rehaul SPEC 9.3): local wake, lunch and wind-down times as "HH:mm".
-- Each app writes its own; the on-device signal channel keeps the three apps aligned.
alter table public.nourish_settings
  add column if not exists wake_at text,
  add column if not exists lunch_at text,
  add column if not exists wind_down_at text;

alter table public.nourish_settings
  add constraint nourish_settings_anchors_hhmm check (
    (wake_at is null or wake_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    and (lunch_at is null or lunch_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    and (wind_down_at is null or wind_down_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  );
