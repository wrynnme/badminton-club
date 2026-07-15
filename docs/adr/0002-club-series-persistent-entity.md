# 0002 — Club series: a persistent club entity above per-session rows

- **Status**: Accepted (2026-07-15, grilled — 15 decisions locked in two rounds).
  **EXPAND + backfill + P1 shipped to prod 2026-07-15 (v0.42.0)** — LINE surfaces
  resolve via series with legacy fallback; membership auto-link live. P2–P4 and
  CONTRACT not started.
- **Scope**: Club side only. Tournaments unaffected. Amends ADR 0001 (see Consequences).
- **Companion docs**: full design + phase roadmap in `spec.md` § "📐 Design — ผูกครั้งเดียวใช้ได้ตลอด"; glossary terms in `CONTEXT.md` § "Club series".

## Context

Today **one `clubs` row = one play session (นัด)**. Every LINE binding hangs off that
per-session row, so managers re-link everything each session. Facts verified by code
exploration (2026-07-15, v0.39.0):

- `clubs.line_group_id` (migration `20260712000100`, UNIQUE partial — one group ↔ one
  club) is written **only** by the inbound webhook command `ผูกก๊วน <join_token>`
  (`src/app/api/line/webhook/route.ts` — `BIND_RE` ~line 46, `handleBind` ~134-171).
  LINE exposes a groupId only via webhook events; there is no app-side bind button.
- `clubs.join_token` (migration `20260711000100`) is the join-link token for the
  manager-confirmed link pool (ADR 0001). Both columns are **not** in the preset
  schema — a new club always starts unbound; the manager must re-post `ผูกก๊วน` and
  re-share the join link every session.
- Player↔LINE links live on `club_players.profile_id`. Presets
  (`applyClubPresetAction`, `src/lib/actions/club-presets.ts` ~551-687) do carry
  `profile_id` — but as a **stale snapshot** captured at preset-save time; players
  linked after the last save are lost.
- The cross-club "known profiles" picker (`listLinkableKnownProfilesAction`,
  `src/lib/actions/club-linking.ts` ~423-468) derives from `club_link_requests`,
  which **CASCADE-deletes with the club** — the implicit registry is not durable.
- Group billing (`pushGroupBillsAction`, `src/lib/actions/club-billing.ts` ~266-393)
  gates on `club.line_group_id` and resolves mentions via
  `club_players.profile_id → profiles.line_user_id`.
- Self-service keyword link (`handleSelfLink`/`resolveSelfLink`, webhook route
  ~178-328) resolves group → club via `line_group_id`, then exact+unique guest-name
  match auto-links; ambiguity falls into the pool.
- LINE bill messages are text + @mentions only — **no app URLs leave the system**
  except `/clubs/join/[token]`. URL restructuring is therefore low-risk.

**Net problem:** there is no persistent identity for the real-world club (e.g.
"MUGGLE") that outlives a single session, so group binding, join link, member links,
locked pairs, and levels cannot persist across sessions.

## Decision

Introduce a **persistent club entity (`club_series`, UI: "ก๊วน") above per-session
rows (`clubs`, UI: "นัด")**. Membership, LINE bindings, partner pairs, and default
levels live at series level; roster/queue/matches/billing stay per session —
**`club_players`/`club_matches` are NOT rekeyed and the queue engine is untouched.**

New schema (all EXPAND-safe, RLS-on no-policy = service-role only):

- `club_series` — `id, owner_id FK profiles, name, line_group_id text UNIQUE?,
  join_token text UNIQUE?, active_session_id FK clubs?, is_adhoc bool default false,
  archived_at timestamptz?, session_defaults jsonb NOT NULL default '{}',
  created_at`. P3 lifts promptpay/receipt config + co-admins here.
- `series_members` — `series_id FK CASCADE, profile_id FK profiles **nullable**
  (NULL = name-only member without LINE), canonical_name text, default_level_id FK
  levels?, is_regular bool default true, first/last_linked_at, partial
  UNIQUE(series_id, profile_id) WHERE profile_id IS NOT NULL`.
- `series_partner_pairs` — two `member_id`s; instantiated into per-session
  `club_locked_pairs` when a session opens.
- `clubs` + `series_id FK?` (legacy rows NULL); `club_players` + `member_id FK?`
  (walk-ins NULL). Legacy `clubs.line_group_id`/`join_token` remain readable as
  fallback during transition; dropped at CONTRACT.
- `club_link_requests` becomes a **series-scoped membership request** (join once,
  not per session).

Grilled decisions (locked 2026-07-15; full detail in `spec.md`):

1. **URL**: series owns `/clubs/[id]`; sessions at `/clubs/[seriesId]/s/[sessionId]`;
   legacy `/clubs/<session-uuid>` 302-redirects (UUIDs cannot collide).
2. **Open-session seeding**: all `is_regular` members auto-seed the roster (name +
   member_id + profile_id + level); adjust via existing roster UI; owner + co-admin.
3. **Active session**: explicit pointer `club_series.active_session_id` — auto-set on
   open, manually switchable, badge in UI. No date heuristics. Opening a new session
   is never blocked by an unbilled old one (binding lives on the series).
4. **Trust**: previously-confirmed members **auto-link without manager** on
   exact+unique+unlinked name match (same rule as keyword self-link); ambiguous →
   pool with "member" badge; first-timers still need one manager confirmation ever.
5. **Backfill**: auto-group legacy sessions by `(owner_id, name)` exact; generate a
   preview from prod for user approval **before** apply; lift bindings up (latest
   non-null wins); build `series_members` from distinct `profile_id` links.
6. **Partner pairs**: series-level, seeded into sessions — ships in **P2**.
7. **Level**: write-through — editing a member-linked player's level in a session
   also updates `series_members.default_level_id`; walk-ins stay per-session.
8. **Presets**: **retired after P2** (UI + actions removed once open-session ships;
   `club_presets` table dropped at CONTRACT). User chose full removal.
9. **RSVP**: out of scope — separate PRD after P2. P4 = cross-session stats only.
10. **Naming (hybrid, revised 2026-07-15)**: "ก๊วน" = series, "นัด" = session as the
   noun/entity term ("นัดปัจจุบัน", "ประวัตินัด") — but the primary open-session
   action button is labeled **"จัดก๊วน"** (verb; natural badminton speech). Never use
   "จัดก๊วน" as a noun for the session entity (avoids stacking "ก๊วน" across both
   layers). th/en parity.
11. **LINE-less members**: `series_members.profile_id` is nullable — a **name-only
   member** (no LINE) is first-class: seeded on open-session like anyone else, just
   unreachable by push. Linking LINE later upgrades the same row in place via the
   normal auto-link/confirm flow (mirrors the guest/linked split on `club_players`).
12. **Ad-hoc sessions keep full LINE features — via a hidden ad-hoc series**: users
   can still create a one-off session without (visibly) creating a club. Under the
   hood this auto-creates a `club_series` with `is_adhoc=true` (name optional, listed
   as a compact "เฉพาะกิจ" entry pointing straight at its session) + one session, so
   LINE binding/join/billing run through the **single** series-level architecture —
   no permanent dual binding path, and the CONTRACT column drops stay on track.
   "อัปเกรดเป็นก๊วนถาวร" = name it + flip `is_adhoc`; nothing moves. Deleting the
   last session of an ad-hoc series deletes the hidden series too (no orphans).
13. **Series deletion**: blocked while any session remains (delete sessions first);
   an **archive** action (`archived_at`) hides a retired club from lists while
   keeping all history, reversibly. Ad-hoc single-session clubs stay easy to delete.
14. **Webhook rebind conflicts**: `ผูกก๊วน <token>` in a group already bound to
   another club — or for a club already bound to another group — returns an explicit
   error naming the current binding and pointing at the in-app unbind
   (series-level `unbindClubLineGroupAction`). Never silent last-write-wins.
15. **Session config source = explicit series defaults** (user chose over
   copy-forward): `club_series.session_defaults jsonb` (venue, times, max_players,
   court_fee, shuttle_price, full queue_settings block, named courts) edited on the
   club settings page; "จัดก๊วน" always reads it; per-session edits do NOT write
   back. The create-club form seeds it; backfill seeds it from each club's latest
   session. This makes the series the living successor of the retired preset system
   (consistent with decision 8).

Rollout: **EXPAND** (additive DDL) → **assisted backfill** (preview → approve) →
cutover PRs **P1** (webhook/billing/join resolve via series + member auto-link) →
**P2** (series home page + URL redirect + open-session + partner-pair/level seeding +
preset removal) → **P3** (lift promptpay/receipt/co-admins) → **P4** (stats, optional)
→ **CONTRACT** (drop legacy columns + `club_presets`; gated, user-approved).

## Alternatives considered

- **A — clone-session + move bindings**: copy roster into a fresh `clubs` row and
  atomically *move* `line_group_id`/`join_token` old→new. Smallest change, but a
  structural hack: the old session's group-bill button dies the moment the binding
  moves, links are ferried forward rather than owned by a durable entity, and no
  cross-session features (stats, persistent pairs/levels) become possible. Rejected.
- **C1 — series-lite** (series table only for bindings + registry, additive, no page
  restructure): 80% of the value, and forward-compatible — but the user explicitly
  chose the full model (2026-07-15) to get the correct domain shape, member-level
  levels/pairs, and the series home page in one committed roadmap. Superseded.
- **Owner-scoped member registry** (no series entity; registry keyed by owner):
  breaks when one owner runs multiple clubs — name collisions across communities
  mis-suggest links. Series scope resolves membership naturally. Rejected.

## Consequences

- **Amends ADR 0001** ("a link is manager-confirmed, never automatic"): the
  exception is widened from keyword self-link to include **returning confirmed
  members** (decision 4). The trust anchor is unchanged — the manager confirmed that
  person's identity once; re-confirming each session adds friction, not safety.
- Club presets are deprecated post-P2 and deleted at CONTRACT — new-club setup
  becomes a plain series-creation form.
- **Known consumers of `clubs.line_group_id` to repoint at P1**: webhook
  bind/self-link, `pushGroupBillsAction`, `unbindClubLineGroupAction`, and the
  site-admin bindings manager on `/admin` (grilled 2026-07-15 — list-all +
  per-club/bulk unbind + owner 1:1 notice; deliberately built thin on the current
  column so this cutover is a two-line repoint).
- `/clubs` becomes a list of series; legacy standalone sessions remain reachable via
  redirects until backfill assigns them to a series.

## Guardrails for implementers (do not violate)

- **Never rekey** `club_matches`/`club_players`/billing off `club_id`; queue engine
  (`src/lib/club/queue.ts`, batch queue, bulk actions) must not change in this work.
- Club tables: **RLS-on with no policies** (service-role only). Never add read-all
  or public policies. New RPCs: `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`.
- **EXPAND/contract discipline**: no column/table drops until the CONTRACT gate with
  explicit user approval; keep legacy fallbacks (`clubs.line_group_id`) readable in
  P1-P3.
- `profiles.line_user_id` is PII — new tables reference `profile_id` only; nothing
  LINE-identifying ships to the client.
- Backfill and any prod DDL: preview + user approval first (R0/R1 gates in
  `AGENTS.md`); migrations via `mcp__supabase__apply_migration`, idempotent.
- i18n: new namespaces/keys in both `messages/th/` + `messages/en/`; ICU `{name}`;
  UI terms per decision 10.
- User-facing phases bump version + `src/lib/changelog.ts` + `CHANGELOG.md`; each
  phase ships green (`npm run typecheck` · `npm test` · `npm run build`, e2e where
  club flows are touched, net-zero seeds).
