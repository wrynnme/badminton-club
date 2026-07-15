-- ADR 0002 — club series (ก๊วนถาวร) P3: lift promptpay/receipt config + co-admins
-- to the series (docs/adr/0002-club-series-persistent-entity.md). EXPAND-only:
-- every new column is nullable/defaulted, the new table is additive, and the
-- legacy `clubs.promptpay_*` / `clubs.receipt_*` / `club_admins` columns/table
-- stay untouched + readable as a fallback during the transition (see
-- resolvePaymentConfig / resolveReceiptConfig in src/lib/club/series-payment.ts
-- and the widened assertCanManageSeries / assertCanManageClub). Dropped at
-- CONTRACT, gated on explicit user approval. Idempotent: every statement
-- guards against re-runs.

-- ── club_series: payment + receipt columns (mirror the `clubs` columns) ─────
alter table public.club_series
  add column if not exists promptpay_id text,
  add column if not exists promptpay_name text,
  add column if not exists promptpay_qr_image text,
  add column if not exists receipt_template jsonb not null default '{}',
  add column if not exists receipt_logo_url text;

-- ── series_admins (co-admins lifted from per-session club_admins) ───────────
create table if not exists public.series_admins (
  series_id uuid not null references public.club_series(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (series_id, user_id)
);

-- FK covering indexes (mirrors 20260521000100_add_fk_indexes' rationale — every
-- FK column gets an index so lookups/deletes don't seq-scan).
create index if not exists idx_series_admins_user_id on public.series_admins (user_id);
create index if not exists idx_series_admins_added_by on public.series_admins (added_by);

-- Service-role only (club-table invariant since 20260614: RLS on, NO policies).
alter table public.series_admins enable row level security;

-- ── Backfill (idempotent) ────────────────────────────────────────────────────

-- 1) Payment/receipt config: copy from each series' ACTIVE session (fallback:
--    latest session by play_date desc, created_at desc — same tie-break as
--    every other ADR 0002 backfill) onto the series, ONLY where the series'
--    own value is still unset. `coalesce` on the plain nullable columns and an
--    explicit `case` on `receipt_template` (its "unset" value is `'{}'`, not
--    `null`) — so this never overwrites a value already lifted by a previous
--    run or set directly through the P3 UI.
with source_session as (
  select distinct on (s.id)
    s.id as series_id,
    c.promptpay_id,
    c.promptpay_name,
    c.promptpay_qr_image,
    c.receipt_template,
    c.receipt_logo_url
  from public.club_series s
  join public.clubs c on c.series_id = s.id
  order by s.id, (c.id = s.active_session_id) desc, c.play_date desc, c.created_at desc
)
update public.club_series s
set
  promptpay_id = coalesce(s.promptpay_id, src.promptpay_id),
  promptpay_name = coalesce(s.promptpay_name, src.promptpay_name),
  promptpay_qr_image = coalesce(s.promptpay_qr_image, src.promptpay_qr_image),
  receipt_template = case
    when (s.receipt_template is null or s.receipt_template = '{}'::jsonb)
      and src.receipt_template is not null and src.receipt_template <> '{}'::jsonb
    then src.receipt_template
    else s.receipt_template
  end,
  receipt_logo_url = coalesce(s.receipt_logo_url, src.receipt_logo_url)
from source_session src
where src.series_id = s.id;

-- 2) Co-admins: the DISTINCT club_admins across every session of each series →
--    series_admins (a manager added as co-admin on any one session of a series
--    already effectively manages the whole series pre-P3 via the
--    assertCanManageSeries legacy fallback — this just makes that explicit at
--    the series level). `added_by` carries the latest non-null value across
--    duplicates (mirrors the P1 binding backfill's "latest wins" rule);
--    `added_at` keeps the earliest sighting. Cross-session duplicates for the
--    same (series, user) collapse via ON CONFLICT on the primary key — this
--    statement is its own top-level INSERT (not chained onto the UPDATE above
--    via a shared WITH clause) precisely because a data-modifying CTE can't see
--    a sibling CTE's writes in the same statement.
insert into public.series_admins (series_id, user_id, added_by, added_at)
select
  c.series_id,
  ca.user_id,
  (array_agg(ca.added_by order by ca.added_at desc) filter (where ca.added_by is not null))[1],
  min(ca.added_at)
from public.club_admins ca
join public.clubs c on c.id = ca.club_id
where c.series_id is not null
group by c.series_id, ca.user_id
on conflict (series_id, user_id) do nothing;
