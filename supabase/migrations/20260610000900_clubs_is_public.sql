-- Club private/public visibility. Default false = manager-only (current behaviour).
-- When true, the club is viewable read-only by anyone at /c/[id] (cost/money hidden).
-- URL is the stable club id (no secret token) — access is gated by this flag at the
-- page level (the public route notFound()s when is_public = false). Additive.
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_clubs_is_public ON public.clubs(is_public) WHERE is_public;
