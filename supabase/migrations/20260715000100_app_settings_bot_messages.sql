-- Site-admin-editable bot message templates (wayfinder #59 / #60).
-- Adds a `messages jsonb` blob to the singleton `app_settings` row (id=1).
-- Keys are the bot-message ids in src/lib/bot-messages.ts; values are the
-- override template strings. Missing keys fall back to the code DEFAULT_MESSAGES
-- (tolerant parse), so an empty '{}' means "use every built-in default".
-- Additive + backward-compatible: existing reads that don't select `messages`
-- are unaffected.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS messages jsonb NOT NULL DEFAULT '{}'::jsonb;
