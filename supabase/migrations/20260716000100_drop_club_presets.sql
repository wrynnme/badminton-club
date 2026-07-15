-- Drop the retired club-preset system's table (CONTRACT item pulled forward by
-- user command 2026-07-16 — "เอาระบบ club_preset ออก").
--
-- History: presets (jsonb template for opening a club) shipped 2026-06-11 and
-- were fully superseded by ADR 0002's club_series.session_defaults; all preset
-- UI + actions were removed in v0.43.0 (P2, 2026-07-16). No code references
-- remain, no FK points at this table. At drop time prod held exactly 1 stale
-- row ("MUGGLE", 2026-07-05) whose role is already covered by the MUGGLE
-- series' session_defaults.
--
-- The rest of the CONTRACT phase (clubs.line_group_id / join_token / payment
-- legacy columns + legacy club_admins) is intentionally NOT included — it
-- stays gated until its own explicit command.

drop table if exists public.club_presets;
