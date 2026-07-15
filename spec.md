# Spec — ก๊วนแบด Tournament System

## Architecture

### Stack

- Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1
- Supabase Postgres (service role, bypass RLS) · MCP connected
- Auth: LINE Login (HMAC-signed `bc_session` cookie; payload carries `iat`, `decode()` rejects tokens older than `MAX_AGE`=30d server-side — cookie maxAge alone is browser-only. 2026-06-09 review fix). **Guest signup REMOVED 2026-06-24 (v0.14.0):** the homepage guest-login form + `POST /api/auth/guest` route deleted — login is LINE-only now; viewers use public links (`/c/[id]`, `/t/[token]`) with no login, and owners still add guest *players* (roster rows, `profile_id=null`) via `add-guest-player`. `SessionPayload.isGuest` + all `isGuest` gates (clubs/new + tournaments/new redirects, `canCreate`, badges) KEPT as defense for any residual legacy guest cookie; LIFF auto-login still upgrades a legacy guest→LINE in place. RPC `create_guest_profile` (migration `20260610000800`) now **orphaned/unused** (left in DB — not dropped; candidate for a future confirmed drop). **Session revocation (2026-06-10):** payload also carries `sv` = `profiles.session_version` (stamped at login); `getSession()` — wrapped in `React.cache()` so the check costs exactly 1 profiles PK read per request (fail-open on DB error) — rejects tokens whose `sv` ≠ live column. Missing `sv` = 0 (graceful — pre-rollout cookies stay valid). `POST /api/auth/logout-all` calls RPC `bump_session_version` (+1) → every previously minted token for that profile dies on the next request; "ออกทุกอุปกรณ์" buttons in `site-header.tsx` (md+) + `mobile-nav.tsx`. A new login does NOT bump — multi-device sessions coexist by design.
- **LINE Browser auto-login (LIFF)** (2026-06-19, separate branch/PR `feat/line-liff-auto-login`): opening the app inside the LINE in-app browser silently signs the visitor in as their LINE account — no button, no OAuth redirect. Client `LiffAutoLogin` (`src/components/auth/liff-auto-login.tsx`, mounted in `(app)/layout.tsx`, runs only when logged-out OR guest) does `liff.init()` → guards `isInClient()` + `isLoggedIn()` → POSTs the LIFF ID token to `POST /api/auth/liff`, which verifies it server-side via LINE `oauth2/v2.1/verify` (checks JWT sig + expiry + `aud`===`LINE_CHANNEL_ID`) then mints the same `bc_session`. A **guest session is upgraded in place** (`setSession` overwrites). Profile upsert is shared with the OAuth callback via `src/lib/auth/line-profile.ts` (`upsertLineProfile` — UPDATE-first preserves user-edited display names). Loop-safe (once per tab via `sessionStorage`; failed attempt falls back to the manual button). Requires env `NEXT_PUBLIC_LIFF_ID` + a LIFF app created **under the existing LINE Login channel** (scopes openid+profile, endpoint URL = app origin); blank = feature off. New dep: `@line/liff`. To guarantee LIFF context for notification deep-links, switch those links to `https://liff.line.me/<LIFF_ID>?...` (follow-up, lives in the notification system).
- Theme: **"Court Energy" (D2) — court-green primary + green-tinted neutral + vivid orange `--brand`** (design-language overhaul 2026-05-30, replaced Teal+Zinc). Picked from a 3-direction compare (`design-preview.html`, throwaway artifact at repo root). Applied via CSS vars in `src/app/globals.css` `:root`/`.dark` only. Light primary/ring = `oklch(0.52 0.16 150)`, dark = `oklch(0.78 0.2 148)`; neutrals green-tinted (hue ~150–158, not Zinc); `--accent` stays a **subtle neutral** (shadcn hover/selected role — NOT the brand orange). Charts = green-family ramp.
  - **Navy rebrand — Phase 1 (2026-06-28, branch `feat/navy-rebrand`):** primary family swapped green→navy to match the new **Kuanbad logo** (navy figure + orange shuttle). `--primary`/`--ring`/`--chart-1`/`--sidebar-primary`/`--sidebar-ring` (+ `-foreground`) now `oklch(0.42 0.18 264)` light / `oklch(0.70 0.15 264)` dark (hue 264 royal-blue, darker than the old green L0.52 so contrast-on-white only rises). **Kept (decision = "primary only"):** `--brand` orange (already matches the logo), `--success`/`--live`/`--winner` green semantic (green = success convention), neutral tint (chroma ~0.008, reads near-gray), divisions, destructive. globals.css-only, re-skins via CSS vars. Phase 2 = logo assets (favicon/header/hero/PWA/OG).
  - **Semantic tokens** (theme-aware — light/dark baked into the var, so no `dark:` at call sites): `--success` `--warning` `--live` `--winner` `--brand` `--destructive`. Division palette `--div-1..8` (1=top). Elevation ladder `--e-1..3` + `--glow` (consume via `var()`), `--shadow-color` HSL triplet. All new colors registered in `@theme inline` so `bg-success`/`text-winner`/`bg-div-1/14` utilities + opacity modifiers exist.
  - **Font tokens** Anuphan is the body and heading face (`--font-sans` → `@theme --font-heading`); Chakra Petch is reserved for scoreboard/display numerals (`--font-chakra` → `@theme --font-display`); mono remains Geist Mono.
  - **Phase 1 done (token foundation, 5 files)**: `globals.css`, `layout.tsx`, `result-display.ts` (RESULT_TEXT/PILL → winner/destructive/warning tokens), `divisions.ts` (DIVISION_COLORS → literal `border-div-N/40 bg-div-N/14 text-div-N` strings — Tailwind v4 needs literals), `public-hero.tsx` (gradient + status pills + trophy → tokens). Token swap re-skins the whole app automatically; verified tsc-clean + light/dark/mobile render on `/t/[token]`.
  - **Phase 2 done (component restyle)** (2026-06-01): (1) canonical status pills → `src/lib/tournament/status-display.ts` (`MATCH_STATUS_LABEL_TH` + `MATCH_STATUS_PILL_CLASS`), consumed by match-queue + tv-match-card (replaced inline amber/green/zinc; court-occupancy banner + KO badge + winner highlight also tokenized). (2) TV/court scoreboard: tv-match-card games-won numerals → `font-display` (Chakra Petch) per-digit columns `text-5xl→7xl`, in_progress gets `.bc-live-card` glow + pulsing `.bc-live-dot` (keyframes `bc-live-pulse` in globals.css, respects reduced-motion); list/queue keep compact numerals by design. (3) responsive: ≤390px overflow fixed via `min-w-0` on the flex chain ((public)+(app) `<main>` + the `/t/[token]` page wrapper — root cause = flex-item `min-width:auto`, not the grids); verified scrollWidth==clientWidth at 360/390/768. (4) touch targets: public TabsTrigger `min-h-11`, queue actions `min-h-11 sm:min-h-8`; dense admin icon buttons left at 24–28px (WCAG 2.5.8 AA). **Figma dropped (2026-06-01)**: design-tool workflow abandoned — the redesign is built directly in code, no mockup/Figma gate. (Throwaway HTML previews `design-preview.html`/`phase2-preview.html` remain at repo root for one-off reference only.)
  - **Phase 2 review polish** (2026-06-01, merged to master): (1) `public-hero.tsx` status palette → 4 distinct treatments (was registering≈ongoing green, draft≈completed neutral): registering `bg-warning/15 text-warning` (amber), completed `bg-foreground/10 text-foreground` (solid-dark chip), ongoing keeps `bg-success/15`, draft keeps `bg-muted`. (2) `match-queue.tsx` QueueRowBody children re-indented inside the `sm:flex-1` wrapper (whitespace only). (3) `--winner` shifted to warm grass-green `oklch(0.47 0.15 142)` light / `oklch(0.84 0.2 140)` dark — distinct from the cool blue-green `--primary`/`--success`/`--live` (hue 148–150) while staying in sRGB gamut + WCAG-AA as card text (6.4:1) AND on the `bg-winner/15` W-pill (5.1:1); light-mode text-AA caps L≤0.5 so hue 142 is the most-distinct AA-safe green. W/L/D result colors stay mutually distinct (green/red/amber). All contrast OKLCH-measured; verified light+dark on hero + pair-stats pills.
  - **Phase 2 surface audit** (2026-06-01): Playwright overflow scan @390/768/1280 across admin tabs (dash/team/pair/ko/settings) + bracket + `/tournaments/new` + clubs + login → **zero overflow** (docScrollW==clientWidth everywhere; phase-2 `min-w-0` chain holds). Fixed the one real finding — winner/result colors that the review-polish `--winner` change had not reached: `match-row.tsx` winner → `text-winner`, `bracket-match-card.tsx` winner highlight `bg-primary/10` → `bg-winner/10`, `tv-standings-carousel.tsx` leader → `text-winner`, `schedule-match-card.tsx` dropped its private status palette to import `MATCH_STATUS_LABEL_TH`/`MATCH_STATUS_PILL_CLASS` (+ winner→`text-winner`, elapsed→`text-success`); notes callout (`t/[token]/page.tsx`) + `csv-import-dialog.tsx` warning text raw amber → `text-warning`/`bg-warning/10`. Print pages (roster/matches) intentionally left neutral gray/blue (paper, not themed UI). Pre-merge review fix (`66da391`): `schedule-match-card.tsx` status-map indexing got tv-card's `?? pending` defensive fallback for parity. **Redesign roadmap complete** (Phase 1 + 2 + review polish + surface audit) — all merged to master + deployed to prod **2026-06-02** (merge `5813bbc`). Figma/design-tool workflow permanently dropped; all design work done directly in code. Shipped to prod as **v0.2.0** (2026-06-02) — minor bump in `package.json` for the D2 design-language overhaul (`NEXT_PUBLIC_APP_VERSION` is read from `package.json` via `next.config.ts`; surfaced in `site-header.tsx`).

### Key Data Flow

- All writes → server actions (`src/lib/actions/`)
- DB queries use `createAdminClient()` (service role key)
- Revalidation via `revalidatePath()` after every write
- Atomic multi-row writes go through Postgres RPCs (single transaction): `record_match_score`, `replace_tournament_matches`, `regenerate_tournament_groups`, `reorder_tournament_queue` — granted to `service_role` only

---

## Current State

### Pair System (flat schema)

`pairs` table: `id, team_id, player_id_1, player_id_2, display_pair_name, pair_level, created_at`

- `pair_level` — DB type `text`; value = `player1.level + player2.level` (numeric sum, stored as text) — no manual input
- `pair_code` column **removed** — use `pair.id` (UUID) as stable upsert key instead
- No junction table — players referenced directly on `pairs`

### Group Stage Division

- `matches.division` column: stores division number as text `"1"`, `"2"`, … `"N"` (legacy `"upper"` = `"1"`, `"lower"` = `"2"`)
- `tournaments.pair_division_thresholds: number[]` — sorted ASC array; replaces singular `pair_division_threshold`
  - `[]` = no division; all pairs play together
  - `pair_level > thresholds[N-2]` → Division 1 (top); …; `≤ thresholds[0]` → Division N (bottom)
  - Division 1 = highest skill tier
- Cross-division matches only in knockout
- Helpers: `computePairDivision(level, thresholds[])`, `divisionTone(n)`, `divisionCount(thresholds)`, `DIVISION_COLORS` — `src/lib/tournament/divisions.ts`
- Division label is **i18n catalog**, not a lib helper: top-level `tournament.division` key (`"ดิวิชั่น {n}"` TH / `"Division {n}"` EN). Consumers call `t("division", { n })` (client `useTranslations("tournament")` / server `getTranslations("tournament")`). The old `divisionLabelTh(n)` lib helper (returned hardcoded English `"Division N"`) was removed 2026-06-14 — it leaked English into the Thai UI.
- Class color: `classTone(index)`, `classToneById(classes, classId)`, `NEUTRAL_TONE`, type `ClassTone` — `src/lib/tournament/class-color.ts` (reuses `DIVISION_COLORS`, cycle-of-8 keyed by class `position` index; null/unknown → NEUTRAL_TONE; no DB color column)

### CSV Import (2-step)

**Step 1 — Players**

```
team, color, id_player*, display_name*, role, level
```

- Upsert by `id_player` (csv_id) — same id → update; new → insert
- Auto-creates teams if not exist

**Step 2 — Pairs**

```
team, pair_id, id_player_1*, id_player_2*, pair_name
```

- `pair_id` optional — UUID of existing pair for upsert; empty = new pair
- `pair_level` not in CSV — auto-computed from player levels on insert/update
- Upsert by `pair_id` (UUID) — found → update; empty → insert new
- Skip if exact player pair already exists
- Team validated via player membership (not `team` column)

### CSV Export

- **ผลแข่งขัน** — match results CSV
- **รายชื่อ** — roster with columns: ทีม, สี, id_player, ชื่อ, ตำแหน่ง, Level, pair_id, คู่, pair_level
- **Template ผู้เล่น** — blank player import template
- **Template จับคู่** — template with empty pair_id (new pairs), player csv_ids pre-filled

### Level Mapping (shared across player + pair)

- Player level: free numeric (`parseFloat`), stored on `team_players.level`
- Pair level: auto = `player1.level + player2.level` (sum); null if both players have no level

---

## Data Contracts

### `PairCsvRow`

```ts
{
  team: string; // informational only
  pair_id: string; // optional — UUID for upsert; empty = new pair
  id_player_1: string; // required — csv_id of player 1
  id_player_2: string; // required — csv_id of player 2
  pair_name: string; // optional
  // pair_level omitted — auto-computed from player levels (sum)
}
```

### `PlayerCsvRow`

```ts
{
  team: string; // required
  color: string; // optional
  csv_id: string; // required — stable upsert key (id_player column)
  display_name: string; // required
  role: "captain" | "member";
  level: string; // optional
}
```

### `Match.division`

`"upper" | "lower" | null` — null = team-mode or undivided pair matches

---

## Done

- Phase 0–4: group stage, knockout (single + double elim), pair mode, CSV import/export, player level, flat pairs, player rename
- Phase 5: bracket visualization at `/tournaments/[id]/bracket`
- Phase 6: Realtime + public share link (`/t/[token]`)
- Phase 7a: LINE Notification + Print/PDF (see below)
- Phase 7b: Co-admin + Audit Log (see below)
- DB fixes: dropped `matches_winner_id_fkey` FK (was referencing `teams.id` — blocked pair mode winner), fixed `matches_round_type_check` + `matches_bracket_check` constraints to allow `upper/lower/grand_final`
- Code review fixes (committed with Phase 7a+7b):
  - `matches.ts` — `loserId` now `null` when `winner === "draw"` (was incorrectly routing team A as loser)
  - `pair-stage.tsx` — per-group open state; was shared `showMatches` collapsing all groups at once
  - `/t/[token]/page.tsx` — pass `pairDivisionThreshold` to `PairStage` (divisions were missing on public page)
  - `admins.ts` — `getCoAdminsAction` now requires `assertCanEdit` (was open to any authenticated user)
  - `permissions.ts` — `assertIsOwner`/`assertCanEdit` throw on DB error instead of returning false; `assertCanEdit` now single-query JOIN (was 2 round-trips)
  - `audit.ts` — `writeAuditLog` logs `console.error` on failure (was silently swallowed)
  - `edit-tournament-form.tsx` — replaced raw `<input type="checkbox">` with shadcn `<Checkbox>`
  - `print-button.tsx` — replaced raw `<button>` with shadcn `<Button>`
  - `tournaments.ts` — `importPlayersCsvAction` parallelized with `Promise.all` (was sequential per row)
- Critical review fixes (2026-05-16):
  - `matches.ts` `recordMatchScoreAction` — reject `winner === "draw"` when `round_type === "knockout"` (previously marked status=completed with winner_id=null, breaking bracket silently)
  - `matches.ts` `insertAndResolveByes` — removed `!m.loserNextMatchId` filter on BYE auto-complete; UR1 BYEs in double-elim now advance correctly (every UR1 match has `loserNextMatchId` set by `buildDoubleBracket`, so the previous filter excluded all double-elim BYEs)
  - `tournament-live-wrapper.tsx` — debounce `router.refresh()` (400ms trailing) to coalesce rapid match updates; subscribe with `event: "*"` (INSERT/UPDATE/DELETE) and additionally watch `tournaments` row so status changes propagate to public/TV views
  - **Atomic write RPCs** (Postgres functions, `SECURITY INVOKER` + `search_path = ''`, executable by `service_role` only):
    - `record_match_score(p_match_id, p_games, p_team_a_score, p_team_b_score, p_winner_slot)` — locks the match row with `FOR UPDATE`, validates `knockout_no_draw`, updates the match, then advances winner to `next_match` slot and loser to `loser_next_match` slot in a single transaction. Replaces 3 separate `UPDATE`s in `recordMatchScoreAction` (race fix: concurrent score writes feeding the same next-match slot are now serialized)
    - `replace_tournament_matches(p_tournament_id, p_round_type, p_matches jsonb)` — atomic `DELETE` + bulk `INSERT` of matches scoped to a `round_type`. Wraps the previous `sb.from("matches").delete()…insert()` pairs in `generateGroupMatchesAction`, `generatePairMatchesAction`, and `insertAndResolveByes`. On insert failure the old bracket survives
    - `regenerate_tournament_groups(p_tournament_id, p_group_names text[], p_assignments jsonb)` — atomic `DELETE groups` (cascades `group_teams` + group-bound matches) + `DELETE` pair-mode group matches + `INSERT groups` + `INSERT group_teams`. Replaces 4 round-trips in `generateGroupsAction`
  - migrations: `rpc_record_match_score`, `rpc_replace_tournament_matches`, `rpc_regenerate_tournament_groups`
- Server High/Medium fixes (2026-05-16):
  - **H1** `matches.ts` `seedsFromStandings` (~L399) — drop non-null assertion; filter out pairs missing from the lookup before `pairSeed`; callers handle `< 2` seeds via existing checks
  - **H2** `permissions.ts` `assertCanEdit` — switch `.single()` → `.maybeSingle()` so owners without a `tournament_admins` row no longer crash with PGRST116; DB errors still throw
  - **H3** `admins.ts` `addCoAdminAction` — fetch `profiles.display_name` and include it in audit log description (`เพิ่ม co-admin: <name> (<line_id>)`)
  - **H4** `admins.ts` `searchProfilesAction` (~L199) — escape `\`/`%`/`_` in user query before `ILIKE`; only apply `.not("id","in",...)` when `excludeIds` is non-empty
  - **H5** `tournaments.ts` `importPlayersCsvAction` + `importPairsCsvAction` — dedupe rows in-batch (player: `team_id:csv_id`; pair: `pair_id` else canonical sorted `player_id_1:player_id_2`) before the upsert loop; last-write-wins for intra-CSV duplicates
  - **M2** `tournaments.ts` `deleteTeamAction` / `removeTeamPlayerAction`, `pairs.ts` `deletePairAction`, `admins.ts` `removeCoAdminAction` — check `error` after `.delete()`; bail before `writeAuditLog` on DB failure
  - **M3** `tournaments.ts` `createTournamentAction` (~L44) — added `writeAuditLog` (`event_type: "tournament_created"`) before `redirect()`
  - **M4** `tournaments.ts` `updateTournamentAction` — snapshot prior fields, diff with the parsed payload, audit-log `event_type: "tournament_updated"` with `อัปเดตการตั้งค่า: <changed fields>`
  - **M5** `tournaments.ts` `generateShareTokenAction` / `revokeShareTokenAction` — audit-log `share_token_generated` / `share_token_revoked` (token value never logged)
  - **M6** `matches.ts` `generateGroupsAction` — fetch `match_unit`; return `{ error: "โหมดคู่ไม่ใช้กลุ่ม" }` when `pair`
  - **M8** `bracket-visual.ts` `roundLabel` — accept `bracketSize`; compute teams-per-round via `bracketSize / 2^(roundIdx-1)` (no more hardcoded 8/16); quarter-final now `"รอบก่อนรองชนะเลิศ"` for consistency with `bracket.ts`
  - **M9** `bracket.ts` `bracketSlots` — throw `Error("bracketSlots requires power-of-2 input")` when `n < 1` or `n & (n-1) !== 0`
  - **M10** `scheduling.ts` `balancedRoundRobin` — iterate `a` over full `sizeA` (was `min(sizeA,sizeB)`) so pairs with `a >= sizeB` are no longer dropped; verified `sizeA=5, sizeB=3 → 15 unique pairs`
- UI High/Medium fixes (2026-05-16):
  - **UI-3** `group-stage.tsx`, `pair-stage.tsx` — collapsible toggles now use shadcn `<Button variant="ghost" size="sm">` (was raw `<button>`); `team-manager.tsx` color swatches kept as `<button type="button">` (visual fidelity) but gained `aria-label` + `aria-pressed`
  - **UI-4** `manual-match-dialog.tsx` — raw `<label>` replaced with shadcn `<Label htmlFor={…}>`; `SelectTrigger` got matching `id`
  - **UI-5** Added `aria-label` to icon-only buttons: `match-row.tsx` (reset), `team-manager.tsx` (save/cancel/edit/remove player/expand/delete team), `pair-manager.tsx` (delete pair), `share-controls.tsx` (copy / revoke), `co-admin-controls.tsx` (remove co-admin)
  - **UI-6** `bracket-match-card.tsx` — removed unused `sumGameScores` import
  - **UI-7** New `src/components/tournament/tv-auto-refresh.tsx` ("use client") calls `router.refresh()` every 60s; mounted in TV page so updates propagate even when status ≠ `ongoing` (Realtime is off)
  - **UI-8** `tv-match-card.tsx` + TV `page.tsx` — added `2xl:` text-size step (heading, name, status badge, court, score, standings table) for 4K mounts
  - **UI-9** `tv-match-card.tsx` — competitor names use `break-words` (allow wrap) and shrink to `text-xl lg:text-2xl 2xl:text-3xl` for names > 30 chars
  - **UI-10** `pair-stage.tsx` — `openGroups` state keyed by stable IDs `'upper' | 'lower' | 'all'`; Thai labels resolved via `GROUP_LABEL` map (was keyed by Thai string)
  - **UI-11** `score-form.tsx` — disable submit when all games are 0:0 with inline "ต้องกรอกอย่างน้อย 1 เกม"; clamp inputs to `max=99` (also enforced in `updateGame`)
  - **UI-12** `csv-import-dialog.tsx` — `FilePicker` clears stale preview rows when a new file fails to parse (`setRows([])` + `onParsed([])`)
  - **UI-13** `co-admin-controls.tsx` — filter out malformed rows missing `user_id` instead of using `||` key fallback; remove button no longer needs `!admin.user_id` guard
  - **UI-14** `edit-tournament-form.tsx` — new `existingTeamCount` prop; inline amber warning when `team_count` set below current team count (`page.tsx` passes `teams.length`)
  - **UI-15** `tournament-tabs.tsx` — active tab synced to `?tab=` via `useSearchParams` + `router.replace(..., { scroll: false })`; defaults to `teams` when missing; `tab=teams` removes the param to keep canonical URL clean

### Phase 5 — Bracket Visualization

- `buildVisualBracket(matches, section)` → `VisualRound[]` (slot height = `CARD_H * 2^roundIdx`)
- `BracketView` — flex columns + CSS connector lines; horizontal scroll
- `BracketMatchCard` — competitors + score + winner highlight
- "ดูสาย" button in knockout-stage links to bracket page (no auth required)

### Phase 6 — Realtime + Share Link

- `tournaments.share_token` (UUID, unique nullable)
- `generateShareTokenAction` / `revokeShareTokenAction`
- `share-controls.tsx` — owner-only generate/copy/revoke
- `/t/[token]` — public read-only page, fetches by share_token, no auth
- `TournamentLiveWrapper` — Supabase Realtime `postgres_changes` (event `*`) on `matches` + `tournaments` → debounced `router.refresh()` (800ms trailing, was 400ms; bumped 2026-05-22 to coalesce more rapid score writes); no visible LIVE badge (removed 2026-07-05)
- `share-controls.tsx` — QR Code button (icon-only, outline) beside copy/revoke when share link exists; opens Dialog with `react-qr-code` SVG (240x240, white bg) + URL below; `react-qr-code@2.0.21`

### Phase 7b — Co-admin + Audit Log

- **DB**: `tournament_admins` (PK: tournament_id + user_id (uuid → profiles.id), added_by (uuid → profiles.id), added_at) + `audit_logs` (id, tournament_id, actor_id, actor_name, event_type, entity_type, entity_id, description, created_at)
  - migration `tournament_admins_user_id_to_uuid`: backfilled LINE user_id text → profile UUID via `profiles.line_user_id` lookup; converted columns `user_id` + `added_by` `text → uuid` and added FK `→ profiles(id)` (user_id ON DELETE CASCADE; added_by ON DELETE SET NULL — column nullable)
- **Permission layer**: `src/lib/tournament/permissions.ts` — `assertIsOwner`, `assertCanEdit` (owner OR co-admin)
- **Audit helper**: `src/lib/tournament/audit.ts` — `writeAuditLog(params)` — inserts to `audit_logs` after every write
- **Co-admin actions**: `src/lib/actions/admins.ts` — `addCoAdminAction`, `removeCoAdminAction` (owner-only), `getCoAdminsAction`, `getAuditLogsAction` (owner + co-admin, limit 50)
- **All server actions updated**: `matches.ts`, `tournaments.ts`, `pairs.ts` — `assertCanEdit` for editable ops, `assertIsOwner` for share-token + structural changes
- **Tenant-scope invariant (2026-06-09, core review IDOR fix)**: `assertCanEdit(input.tournamentId)` only proves rights on that tournament — it does NOT prove the target row (match/team/player, loaded by its own id) belongs to it. Every action that loads a row by id then writes it MUST also assert the row's `tournament_id === input.tournamentId` before the write. Enforced in `recordMatchScoreAction` / `resetMatchScoreAction` (matches.ts; record also rejects re-recording a `completed` match to avoid double-counting standings) and `addTeamPlayerAction` / `removeTeamPlayerAction` / `deleteTeamAction` (tournaments.ts), mirroring the pre-existing `toggleTeamPlayerCheckInAction` pattern. Without it any LINE user could tamper across tournaments (match ids are public on `/t/[token]`).
- **Co-admin UI**: `co-admin-controls.tsx` — owner-only Card; searchable Combobox (shadcn `Popover` + `Command`) to find profiles by `display_name`; list + remove
  - Server search: `searchProfilesAction(tournamentId, query)` — owner-gated, ILIKE on display_name, excludes self + existing co-admins + profiles without `line_user_id`; **returns only `{id, display_name}` — `line_user_id` is NOT selected (PII; used only as a server-side guest filter)**; limit 20
  - Debounced 250ms client-side; `shouldFilter={false}` (server filters)
  - `CommandList` keeps a stable structure (one `CommandEmpty` with dynamic text + one `CommandGroup`) — cmdk requires this; mixing multiple conditional `CommandEmpty`/raw elements breaks its child diffing
  - On submit, passes selected profile's **opaque `id`** to `addCoAdminAction(tournamentId, profileId)` (UUID-validated, resolved by `id`, guest/self blocked). **PII fix 2026-06-09:** search no longer returns or displays `line_user_id` (was a PII-enumeration oracle); add keys on profile id instead of LINE id.
- **Audit log UI**: `audit-log-panel.tsx` — collapsible Card; fetches on first open; newest-first list
- **Page**: `canEdit = isOwner || isCoAdmin` — `TournamentStatusControl` + all edit components use `canEdit`; owner-only: `ShareControls` + `CoAdminControls`; settings tab visible to `canEdit` — co-admin sees `CourtManager`, `SettingsManager`, `EditTournamentForm`, `AuditLogPanel` but not `ShareControls`/`CoAdminControls`

#### Permission Matrix

| Action                      | isOwner | isCoAdmin |
| --------------------------- | ------- | --------- |
| Record/reset scores         | ✓       | ✓         |
| Add/edit/remove players     | ✓       | ✓         |
| Manage teams/groups/bracket | ✓       | ✓         |
| Change tournament status    | ✓       | ✓         |
| CSV export                  | ✓       | ✓         |
| Create/revoke share link    | ✓       | ✗         |
| Add/remove co-admins        | ✓       | ✗         |
| Update tournament settings  | ✓       | ✓         |
| Edit courts / tournament form | ✓     | ✓         |
| View audit log              | ✓       | ✓         |

### Manual Match Creation (pair mode)

- **Action**: `createManualMatchAction({ tournamentId, pairAId, pairBId })` in `matches.ts`
  - Validates same division (computed from `pair_level` via `computePairDivision(pair_level, pair_division_thresholds[])`)
  - Inserts `round_type="group"`, `match_number=max+1`, `division` auto-computed
  - writeAuditLog `event_type="match_created"`
- **UI**: `manual-match-dialog.tsx` — Dialog + 2 Select dropdowns
  - Pair B options auto-filter to same division as Pair A
  - Shown in `pair-stage.tsx` "การแข่งขัน" header (canEdit, only when matches exist)
  - `PairStage` receives `pairDivisionThreshold` prop from page

### Pair mode `group_knockout` Knockout

- `generateKnockoutAction` supports pair mode with ALL formats now
- Seeds from `computeStandings()` after group stage
- No division: top `advance_count` pairs overall → single bracket
- With division: top `advance_count` from upper + lower → `buildIndependentDoubleBracket` (upper + lower + grand final)
- `knockout_only` pair mode: seed all pairs (no standings needed)
- **KO `match_number` continuous across stages (2026-05-22)**: queries `max(match_number) WHERE round_type='group' AND tournament_id=...` once and passes that offset to all insertion paths. Pair-mode inserts apply `m.matchNumber + groupMax`; team-mode `insertAndResolveByes` helper accepts `matchNumberOffset` (default 0). No UNIQUE constraint on `match_number` → safe to offset; KO matches now numbered after group matches in display.

### UI Improvements

- Tournament detail page split into tabs: **แดชบอร์ด · ทีม · กลุ่ม\* · คู่\* · น็อคเอ้า\* · ตารางคิว\* · ตั้งค่า\*\*** (\* conditional per format/state, \*\* owner+co-admin only). `แดชบอร์ด` always shown; `กลุ่ม` only when `match_unit=team` + format includes group stage; `คู่` only when `match_unit=pair`; `น็อคเอ้า` only when format includes knockout; `ตารางคิว` shown once matches exist; `ตั้งค่า` hidden for public viewers.
- `Loader2` spinner on all pending/loading buttons
- Error messages — Thai-friendly throughout; no raw `error.message` from DB exposed to UI
- Settings tab (owner-only): `edit-tournament-form.tsx` — TanStack Form pre-populated with current tournament data, calls `updateTournamentAction`

---

## Done (continued)

### Phase 7a — LINE Notification + Print/PDF

- **LINE notification**: `src/lib/notification/line.ts` — `notifyTournamentAdmins(tournamentId, text)` sends LINE push to owner + all co-admins
  - Env var: `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` (silently skipped if missing or no recipients have line_user_id)
  - Recipients: dedupe `[owner_id, ...tournament_admins.user_id]` (all profile UUIDs now), single `profiles.line_user_id IN (...)` lookup
  - Delivery: LINE `/push` for 1 recipient, `/multicast` for 2+ (up to 500 IDs per request)
  - Errors logged to `console.error` (API non-2xx + exceptions); no success/recipient logs (low noise)
  - Non-blocking: `.catch(() => {})` at the caller — never affects action result
  - **3 triggers**:
    | Trigger | Action | Message |
    |---|---|---|
    | Record match score | `recordMatchScoreAction` | `🏸 A vs B\nเกมที่ชนะ: 2:1 (21-15, 18-21, 21-19)\nผู้ชนะ: ชื่อ` |
    | Generate knockout bracket | `generateKnockoutAction` (2 code paths) | `สร้างสายน็อกเอาต์แล้ว` |
    | Tournament status change | `updateTournamentStatusAction` | `สถานะเปลี่ยนเป็น: <Thai label>` |
  - **Not triggered**: reset score, create/delete team/group/pair/match, add/remove co-admin, export/print, update tournament settings
- **Print pages**: `/tournaments/[id]/print/matches` + `/tournaments/[id]/print/roster` — server-rendered, print-optimized; nav hidden on print
- **Bracket print**: `src/components/ui/print-button.tsx` client component → `window.print()`; added to bracket page header
- **Export buttons**: added `tournamentId` prop + "พิมพ์:" section with match + roster links (open new tab)

### Version Badge

- **Build-time env injection** (`next.config.ts`):
  - `NEXT_PUBLIC_APP_VERSION` — read from `package.json` via `readFileSync` + `JSON.parse`
  - (commit-hash injection removed 2026-07-10 — badge shows version only; `execSync`/`gitHash`/`NEXT_PUBLIC_GIT_COMMIT` dropped)
- **UI**: `SiteHeader` shows outline `Badge` next to 🏸 ก๊วนแบด logo with `v{version}` (links to `/whats-new`) — `hidden sm:inline-flex` (mobile-hidden)

### Public Share Page Redesign (`/t/[token]`)

- **Layout**: hero banner + notes banner + tabs (แดชบอร์ด / ทีม\* / กลุ่ม\* / คู่\* / สาย\* / ตารางคิว\* — `ภาพรวม` tab removed 2026-05-22)
- **`PublicHero`** (`src/components/tournament/public/public-hero.tsx`) — server component:
  - Gradient card: `from-amber-50 via-background to-orange-50` + 1px gold accent stripe + decorative bg trophy
  - Title row: amber Trophy icon + tournament name + TV button (secondary)
  - Status pill (custom colors per status) + venue + date meta row
  - Stat grid 2×2 → 4-col: รูปแบบ / ทีม / คู่แข่ง / การแข่งขัน (`completed/total`)
  - Action row: `ExportButtons` + "ดูสาย" bracket link (conditional)
- **`PublicOverview` — REMOVED 2026-05-22** (commits `091337a` + `294dafb`): the `ภาพรวม` tab + `src/components/tournament/public/public-overview.tsx` file were both deleted. The Dashboard tab (`TournamentDashboardLazy`) now serves as the default landing view on `/t/[token]`; cross-team standings + division standings + queue snapshot moved into Dashboard.
- **`PublicTournamentShell`** (`src/components/tournament/public/public-tournament-shell.tsx`) — client component:
  - `Tabs variant="line"` with border-b underline style
  - Tabs: แดชบอร์ด (always) · กลุ่ม · คู่ · สาย · ตารางคิว (conditional on format/unit/matches-exist); `ทีม` is admin-only and not rendered here
  - Active tab synced to `?tab=` URL param via shared `useTabSync` hook (`src/lib/hooks/use-tab-sync.ts`); lazy-mount per tab via the same hook's `mounted: Set<TabId>` (seeds `defaultTab` for instant first paint)
  - Wrapped in `<Suspense>` on parent page (`/t/[token]/page.tsx`) — `useSearchParams` boundary requirement under Next 16 App Router
  - Receives pre-rendered `ReactNode` props — server data stays server-side across the boundary
- **Notes banner**: amber left-border strip (`border-l-4 border-amber-400`) with `Info` icon
- Container widened to `max-w-5xl`
- `FORMAT_LABEL` map: `group_only` → "แบ่งกลุ่ม", `group_knockout` → "กลุ่ม + สาย", `knockout_only` → "สายเดียว"

### Phase 8 — TV Display Mode

- **Route**: `/t/[token]/tv` — public, no auth; requires valid `share_token`
- **`TvDisplayPage`** (`src/app/(public)/t/[token]/tv/page.tsx`):
  - `force-dynamic` rendering
  - Fetches tournament, teams, pairs (with players), all matches in parallel
  - **Upcoming/in-progress** section: up to 8 matches; sorted `in_progress` first → by `match_number`
  - **Standings** sidebar: top 8 by `computeStandings()`; shown only when `played > 0`
  - **จบล่าสุด** sidebar: latest 6 completed matches by `match_number` desc
  - Wraps in `TournamentLiveWrapper` — Realtime updates on match changes
  - Mounts `TvAutoRefresh` ("use client", `src/components/tournament/tv-auto-refresh.tsx`) — `router.refresh()` every 60s as fallback when Realtime is off (status ≠ `ongoing`)
  - "ออก TV" link back to `/t/[token]`
- **`TvMatchCard`** (`src/components/tournament/tv-match-card.tsx`):
  - Large-format card: text-2xl/4xl; status pill; court badge
  - Winner → green + bold; loser → muted + line-through
  - Completed: game score (`gamesA : gamesB`) + point totals (`totals.a–totals.b`); pending: "VS"
  - Supports `unit: "team" | "pair"`; renders color dot + subtitle
- **TV button** on public share page (`/t/[token]`): outline `Button` with `Tv` icon beside status badge → links to `/t/[token]/tv`
- **`matchRowSize` prop** — `"compact"` (default) | `"comfortable"` — added to `MatchRow`, `GroupStage`, `PairStage`, `KnockoutStage`, `BracketSection`
  - `comfortable`: larger text (base → lg), bigger score (lg/2xl bold), larger color dot (2.5/3)
  - Public share page passes `matchRowSize="comfortable"` to all stage components
- **Public page layout** improvements: container widened to `max-w-4xl`; responsive padding `px-3 sm:px-4 lg:px-6`; info grid `grid-cols-2 sm:grid-cols-4`

---

## Club System

### Permission Helpers (`src/lib/actions/clubs.ts`)

- **`assertClubOwner(sb, clubId, profileId)`** — owner-only check; `maybeSingle()`, throws on DB error
- **`assertCanManageClub(sb, clubId, profileId)`** — owner OR co-admin; LEFT JOIN query `clubs ← club_admins[user_id=profileId]`; `maybeSingle()`, throws on DB error

| Action                                                      | Owner | Co-Admin | Player |
| ----------------------------------------------------------- | ----- | -------- | ------ |
| เช็คอิน / Kick / Reorder / Add guest                        | ✓     | ✓        | ✗      |
| Edit club / Expenses / Cost config / Queue / Locked / Match | ✓     | ✓        | ✗      |
| Add/remove co-admins / Share link                           | ✓     | ✗        | ✗      |

### LINE linking (เชื่อม LINE) — ✅ IMPLEMENTED 2026-07-11 (v0.28.0, PR #35 → develop; realtime pool + ship-check/bug-hunt hardened; net-zero live-smoke PASS) + link-from-edit-form 2nd entry point (branch `feat/club-link-known-profile`, stacked on #35)

Attaches a real LINE account to an existing **guest** `club_players` row so club billing/notification push reaches a player who was previously `profile_id IS NULL` (`skippedNoLine`). v1 = **club-only, outbound-push-only**. Design/decisions: `docs/adr/0001-line-linking-via-manager-confirmed-pool.md`; glossary: `CONTEXT.md` → "LINE linking". Rejected alternatives (direct claim link / pick-from-list / bot inbound) documented in the ADR.

- **Mechanism** — manager-confirmed pool (NOT auto-claim): a per-club `clubs.join_token` (mirrors `tournaments.share_token`) → player opens `/clubs/join/[token]` + LINE Login → `requestClubLinkAction` upserts a `pending` row into `club_link_requests` → manager links it to a guest row or dismisses it.
- **Schema** — migration `20260711000100_club_line_link` (applied prod): `clubs.join_token text` + partial-unique index `uniq_clubs_join_token (join_token) WHERE join_token IS NOT NULL`; table `club_link_requests` (id, club_id FK CASCADE, profile_id FK profiles CASCADE, status `pending|matched|rejected`, created_at, `UNIQUE(club_id, profile_id)`); RLS on + no policy (service-role only) + REVOKE anon/authenticated (club-table invariant). `join_token` redacted to null in `toPublicClub`. Two follow-up migrations (applied prod 2026-07-11): `20260711000200_club_link_requests_realtime` — adds an AFTER INSERT/UPDATE/DELETE trigger on `club_link_requests` reusing `club_queue_broadcast()` (signal-only `{club_id, table}` on public topic `club:<id>`, no PII) so the pool live-updates; `20260711000300_club_players_unique_profile` — partial-unique index `uniq_club_players_profile (club_id, profile_id) WHERE profile_id IS NOT NULL` closing a concurrent double-link hole (one profile → two rows).
- **Actions** (`src/lib/actions/club-linking.ts`, all `createAdminClient` + `club_audit_logs`): `generateClubJoinTokenAction` / `revokeClubJoinTokenAction` (`assertCanManageClub`); `requestClubLinkAction(token)` (public — `session.profileId`, idempotent upsert, returns `pending`/`already_linked`); `linkClubPlayerAction({clubId, requestId, targetPlayerId, useLineName})` (guard: profile-already-linked-in-club → reject, target must be guest; sets `profile_id`, optional LINE-name adopt [default keep], marks `matched`, fire-and-forget `pushTextToUser` confirm); `dismissClubLinkRequestAction`; `unlinkClubPlayerAction` (`profile_id=NULL` + request → `pending`); `listLinkableKnownProfilesAction(clubId)` + `linkKnownProfileAction({clubId, targetPlayerId, profileId, useLineName})` (manager-initiated link of a known profile from the edit form — see the second-entry-point note below).
- **UI** — `club-link-controls.tsx` (manager card in settings tab: `ShareLinkRow`+QR join link + pool list with link/dismiss + name-choice dialog); public `/clubs/join/[token]` server page (session-gated → LINE Login redirect; states join/pending/already-linked/invalid) + `club-join-confirm.tsx` client button; `sortable-player-list.tsx` PlayerRow gains a "LINE" linked badge + an unlink control in the edit dialog (guest rows also get a "เชื่อม LINE" button → nested `LinkKnownDialog`, see the second-entry-point note). i18n `club.linking.*` + `club.playerList.{linkedBadge,linkedLabel,unlink*,linkKnown*}` + `actions.club.link*` (th/en parity).
- **Realtime** — the pool (in `ClubLinkControls`, settings tab) live-updates via the existing `ClubLiveWrapper` (broadcast topic `club:<id>` → debounced `router.refresh()`, server re-fetch); the `20260711000200` trigger fires the signal on any `club_link_requests` change. Respects the club's `realtime_enabled` setting. No client change was needed (the whole club page is already wrapped).
- **Verify (2026-07-11)** — tsc 0 · vitest 825/825 · i18n club 888=888 / actions 243=243 · build OK · **net-zero Playwright smoke PASS** (player join→pending row · manager link→`profile_id` set · request→matched · name-kept default; teardown 0 rows) · **realtime live-smoke PASS** (page open + SQL INSERT pending → pool `(0)`→`(1)` with no navigation, console 0 err). Ship-check + focused bug-hunt (2 adversarial reviewers): fixed P1 double-link race (`uniq_club_players_profile`), P2 join-confirm state (already-linked vs pending), P3 dismiss false-success + non-atomic `matched` write; P2 dismiss-durability left as-is for v1 (token revocable + manager-gated). Tournament `team_players` linking OUT of scope (no consumer).
- **Second entry point — link from the edit form (2026-07-11, same v0.28.0)** — a manager can attach a KNOWN profile directly from the guest edit dialog, no fresh scan. `listLinkableKnownProfilesAction(clubId)` returns `{id, display_name, picture_url}[]` of profiles that opted into ANY of the manager's own clubs (a `club_link_requests` row of any status **except `rejected`** — a dismissed request must not resurface), minus those already linked in THIS club; `linkKnownProfileAction({clubId, targetPlayerId, profileId, useLineName})` re-verifies the same consent predicate (a forged `profileId` with no request in the manager's clubs → reject), reuses the guest-target + already-linked + rows-affected + `uniq_club_players_profile` guards, retires any pending pool request for the profile in this club, and fires the same confirm push. UI = a "เชื่อม LINE" button in the guest branch of `EditPlayerForm` → nested `LinkKnownDialog` (search + avatar list + keep/use-LINE-name toggle) in `sortable-player-list.tsx`; type `LinkableKnownProfile` in `@/lib/types`; i18n `club.playerList.linkKnown*` (th/en parity). **Net-zero Playwright smoke PASS** (seed manager+known profile+guest row+pending request → open edit → เชื่อม LINE → picker lists the known profile → pick + use-LINE-name → `profile_id` set to known id · `display_name` adopted · request→matched · audit `player_linked` · console 0 err; teardown 0 rows). Consent rationale in the ADR.

### LINE sign-up import (วางรายชื่อจากไลน์) — ✅ IMPLEMENTED 2026-06-13 (develop, static green — ยังไม่ live-smoke/commit)

วางข้อความ "ลงชื่อ" จากไลน์ → parse → preview ติ๊กเลือก → เพิ่มผู้เล่น guest เข้าก๊วนที่มีอยู่ทั้งชุด.

- **Parser** `src/lib/club/line-signup.ts` — pure `parseLineSignup(text)` → `{ players: ParsedSignupPlayer[], reserves: ParsedSignupPlayer[] }` โดย `ParsedSignupPlayer = {name, start_time, end_time}`. กติกา: บรรทัด `^\s*(\d{1,3})[.)\s]\s*ชื่อ` = ตัวจริง — **ตัวคั่นหลังเลขรับ จุด/วงเล็บ/เว้นวรรค** (`1. ชื่อ` · `26.ชื่อ` ไม่มีเว้นวรรค · `1 Kevin` เว้นวรรคล้วน — 2026-06-13); เลขเปล่า `22.`/`22 ` → ข้าม; ต้องมีตัวคั่นอย่างน้อย 1 ตัว (กัน `1stCourt`); cleanup = trim + ยุบช่องว่างซ้อน + ตัด `@` นำหน้า (คง `*`/emoji/วงเล็บหมายเหตุ) + clamp 60; **ดึงช่วงเวลาท้ายชื่อ (2026-06-13)** — pattern `H[:.]MM-H[:.]MM` ท้าย string (จุดหรือ colon, วงเล็บครอบได้ เช่น `ป๊อก 18.00-20.00` / `มังกร (19.00-21.00)`) → normalize เป็น `HH:MM` + ตัดออกจากชื่อ; วงเล็บที่ไม่ใช่เวลา (`เจ2 (ต้าน)`) ไม่ถูกแตะ; บรรทัด `สำรอง` เดี่ยวๆ → สลับโหมดสำรอง (จนเจอบรรทัดว่าง/ช่องว่างล้วน แล้วหยุด); **โหมดสำรองเข้าใจทั้งชื่อเปล่า (`เอ`) และเลขมีจุด (`15. แอน` หรือช่องว่าง `15.` → ข้าม)** + ตัดบรรทัดตกแต่งล้วน (ไม่มีตัวอักษร/เลข) ทิ้ง (2026-06-13); close marker = บรรทัดที่มี `❌` หรือเป็น `ปิด` ล้อมด้วยอักขระตกแต่งใดๆ (`❌❌ปิด❌❌` · `***ปิด***` · `===ปิด===` — regex `[^\p{L}\p{N}]*ปิด[^\p{L}\p{N}]*`); อย่างอื่น (หัวข้อความ 🗓️/📍/⏰/`****`, ท้ายข้อความ ค่าสนาม/เกมละ/@All) ไม่ถูกอ่านเป็นชื่อ. **84 vitest** รวม 4 fixtures จริง (36+3 dot · 33+0 dot+เวลา 8 คน · 21+3 DADDY HOUSE space-sep · 13+0 ทัศนาฯ ช่องสำรองเลขเปล่า+asterisk-ปิด).
- **Action** `importClubPlayersAction({club_id, players[], reserve_players[]})` (`club-players.ts`; แต่ละ item = `{name, start_time?, end_time?}`) — getSession→loginRedirect, zod (ชื่อ 1–60 + เวลา `HH:MM` regex, main ≤100/reserve ≤50), `assertCanManageClub`; dedupe case-insensitive ทั้งใน batch และกับ `club_players.display_name` เดิม (นับ skipped); ตัวจริง loop ผ่าน **RPC `add_club_player`** ทีละคน (คง atomic capacity → เต็มแล้วได้ reserve อัตโนมัติ; error รายคน → นับ failed แล้วไปต่อ) แล้ว **Promise.all อัปเดต start/end_time ตาม (club_id, display_name)** — ปลอดภัยเพราะ dedupe การันตีชื่อไม่ซ้ำใน batch และชื่อที่มีอยู่เดิมถูก skip ก่อนแล้ว (time-update พังไม่ลด `added` — เป็น best-effort enrichment); สำรอง insert ตรง `status='reserve'` + เวลาในแถวเลย ต่อท้าย `max(position)+i`; คืน `{ ok, added, reserved, skipped, failed }`; revalidate club path. เวลาที่ import เข้าไปใช้กับหารค่าสนาม by_time + จำนวนคนต่อช่วง.
- **UI** `src/components/club/line-import-dialog.tsx` — ปุ่ม "วางรายชื่อจากไลน์" (Tooltip) ข้าง `AddGuestPlayer` ในแท็บลงชื่อ (`clubs/[id]/page.tsx`, gated `canManage`); Dialog 2 step: Textarea+อ่านรายชื่อ → preview checklist (กลุ่มตัวจริง/สำรอง, default checked; ชื่อที่มีในก๊วนแล้ว = unchecked + badge "มีอยู่แล้ว") → ยืนยัน → toast สรุป added/reserved/skipped + `router.refresh()`. i18n `club.lineImport.*` 19 keys + `actions.club.*` 2 keys (th/en parity).

### Bulk-select หน้าลงชื่อ (เลือกหลายคน) — ✅ IMPLEMENTED 2026-06-13 (develop)

โหมดติ๊กเลือกหลายคนใน `sortable-player-list.tsx` (ปุ่ม "เลือกหลายคน"/"เสร็จสิ้น", canManage only; เปิดแล้ว dnd ปิด — `useSortable disabled: !canManage || selectMode` ทั้ง active+reserve, drag handle ซ่อน; per-row Checkbox + select-all แบบ indeterminate) + sticky `BulkActionBar` เมื่อเลือก ≥1: เช็คอิน / ยกเลิกเช็คอิน / ตัวจริง / สำรอง / แก้เวลา (`BulkSessionDialog` — enable-checkbox ต่อ field ส่งเฉพาะช่องที่ติ๊ก; games ถอดออก 2026-07-08) / ลบ (`BulkDeleteDialog` — รายชื่อ scrollable + impact bullets + ปุ่มแดง; ทั้งสอง dialog มี `max-h-[90dvh] overflow-y-auto`). 4 actions ใหม่ใน `club-players.ts`: `bulkCheckInClubPlayersAction({clubId,playerIds,checkIn})` (idempotent `.is/.not null` mirror tournament pattern, คืน `{ok,count}`) · `bulkSetClubPlayerStatusAction({clubId,playerIds,status})` (admin override ไม่เช็ค cap, `.neq(status)` อัปเดตเฉพาะ row ที่ต่าง, คืน `{ok,count}`) · `bulkUpdateClubPlayerSessionAction({clubId,playerIds,start_time?,end_time?})` (patch เฉพาะ field ที่ส่ง, `""`→null, reject 0 fields, คืน `{ok,count}`) · `bulkDeleteClubPlayersAction({clubId,playerIds})` (sequential RPC `remove_club_player_and_promote` ต่อ id — preserve auto-promote semantics, คืน `{ok,deleted,failed}`). ทั้งหมด zod uuid array 1..100 dedupe · `assertCanManageClub` · tenant-scope `.eq("club_id",…).in("id",…)` · `revalidatePath`. i18n: `club.bulkSelect.*` 35 keys + `actions.club.*` 9 keys (th/en parity).

### Bulk-select หน้าคิว (เลือกหลายแมตช์) — ✅ IMPLEMENTED 2026-07-10 (v0.27.0)

โหมดติ๊กเลือกหลายแมตช์ใน `club-queue-panel.tsx` — **แยกกันต่อ section** (`รอแข่ง` + `จบแล้ว` มี select mode + sticky `QueueBulkBar` ของตัวเอง, การเลือกไม่ปนกัน; `กำลังแข่ง` เป็น per-row เท่านั้น). ปุ่ม "เลือก"/"เสร็จ" ต่อ section (canManage only); เข้าโหมดเลือกใน `รอแข่ง` จะ**ปิด DnD** (render plain list แทน SortableContext); per-row `Checkbox` + select-all แบบ indeterminate. **Pending bulk:** จัดสนาม (`bulkSetClubMatchCourtAction` — pending ไม่มี occupancy constraint ใส่สนามเดียวหลายแมตช์ได้) · ยกเลิก (`bulkCancelClubMatchesAction`, soft `status='cancelled'`) · เริ่มแข่ง (`bulkStartClubMatchesAction`) · ลบถาวร (`bulkDeleteClubMatchesAction`, confirm dialog). **Completed bulk:** ลบถาวร อย่างเดียว. **Bulk-start auto-court:** pure helper `planBulkStartCourts` (`src/lib/club/bulk-start.ts`, 10 vitest) — เดินตามลำดับคิว, แมตช์เก็บสนามตัวเองถ้าว่าง ไม่งั้นรับสนามว่างถัดไป (`clubs.courts` ที่ไม่ถูก in_progress ยึด + ยังไม่ถูก batch จองก่อนหน้า); ข้ามแมตช์ที่ผู้เล่นไม่ครบ / รอผู้ชนะ (live placeholder) / ผู้เล่นซ้ำกับที่เริ่มใน batch หรือ in_progress อยู่ / ไม่มีสนามว่าง — รายงาน "เริ่ม X · ข้าม Y" ผ่าน toast key เฉพาะ (ไม่ต่อ string). 4 actions ใน `club-matches.ts`: แต่ละตัว `assertCanManageClub(clubId)` ครั้งเดียว · ทำเฉพาะ row ที่ `.eq("club_id",clubId).in("id",matchIds)` filter ตาม status ที่คาด (cross-club/wrong-status ids ถูกข้ามเงียบ) · single `revalidatePath` · per-item result shape (`{updated}`/`{cancelled}`/`{started,skipped}`/`{deleted,failed}`). `cleanBulkMatchIds` dedupe + cap 200. **Bulk delete รันแบบ sequential** (winner_next_match_id เป็น ON DELETE SET NULL → parallel delete ของคู่ feeder+target อาจ deadlock). Cancel/delete คง parity กับ single action (ไม่ล้าง downstream feeder pointer). i18n: `club.queuePanel.bulk*`/`toastBulk*` (th/en parity). ไม่มี DB migration.

### Visibility — Private / Public (ก๊วน public) — ✅ DONE (2026-06-10, develop)

ก๊วนเป็น **private (default)** = manager เท่านั้น (non-manager โดน redirect ที่ `clubs/[id]/page.tsx`). owner เปิดเป็น **public** ได้ → ดู read-only ที่ `/c/[id]` โดยไม่ต้อง login (ลิงก์ถาวรอิง club id, ไม่ใช่ secret token; gate ด้วย flag).
- **DB**: migration `20260610000900_clubs_is_public` — `clubs.is_public boolean NOT NULL DEFAULT false` + partial index `idx_clubs_is_public WHERE is_public`. APPLIED to prod 2026-06-10 (additive; 0 public = behavior เดิม).
- **Action** (`clubs.ts`): `setClubVisibilityAction(clubId, isPublic)` — **owner-only** (`assertClubOwner`), UPDATE `is_public`, revalidate `/clubs/[id]` + `/c/[id]`. ไม่มี audit (clubs ไม่มี audit_logs). `Club.is_public` ใน types.
- **Public route**: `src/app/(public)/c/[id]/page.tsx` (`force-dynamic`) — `createAdminClient()` fetch by id, `if (!club || !club.is_public) notFound()`. render `<ClubTabs hideCost showSettings={false}>` (dashboard/ลงชื่อ/ล็อคคู่+คิว เท่านั้น) ด้วย `canManage=false`, `sessionProfileId=null`. **ซ่อนเงิน**: ส่ง `publicClub = {...club, court_fee:0, shuttle_price:0, total_cost:0}` + `expenses=[]` ลง client (ราคา/expense ไม่ ship ไป client เลย ไม่ใช่แค่ซ่อน UI); usage (ชม./เกม/ลูก) คำนวณจาก sessions+matches ปกติ.
- **`hideCost` prop** (ใหม่): `club-tabs.tsx` (ตัดแท็บค่าใช้จ่ายทั้งแท็บ + จาก validTabs) · `club-dashboard.tsx` (ซ่อน stat card `ค่าใช้จ่ายรวม`/`เฉลี่ย/คน` + column `ค่าสนาม`/`ค่าลูก`/`รวม` ในตารางผู้เล่น; คง usage columns).
- **Owner UI**: `club-visibility-controls.tsx` (mirror tournament `share-controls.tsx` แต่เป็น Checkbox flag ไม่ใช่ generate/revoke token) — toggle "เปิดให้คนทั่วไปดู" + ลิงก์ `${appUrl}/c/${clubId}` + copy + QR dialog (`react-qr-code` dynamic). mount ในแท็บตั้งค่า (owner-only, ข้าง EditClubForm). `appUrl = NEXT_PUBLIC_APP_URL`.
- tsc 0 · vitest 470/470 · live-smoke (throwaway guest club, net-zero): private→/c/[id] not-found (ไม่มี club data) · toggle public→club render เต็ม + **0 cost marker** + ไม่มีแท็บค่าใช้จ่าย/ตั้งค่า · cleanup net-zero (NOMKONZ intact).
- **Phase 2 (optional, ยังไม่ทำ)**: public directory `/(public)/c` list ก๊วน `is_public=true`.

### Co-Admin

- **DB**: `club_admins` — PK `(club_id, user_id)`; FK `club_admins_club_id_fkey → clubs ON DELETE CASCADE`; FK `club_admins_user_id_fkey → profiles ON DELETE CASCADE`; `added_by` nullable FK → profiles ON DELETE SET NULL
- **Actions**:
  - `addClubCoAdminAction(clubId, profileId)` — owner only; UUID-validate → resolve by `profiles.id`; duplicate → error 23505. **(PII fix 2026-06-09: was `lineUserId`; now keys on opaque profile id.)**
  - `removeClubCoAdminAction(clubId, userId)` — owner only; checks delete error
  - `searchClubProfilesAction(clubId, query)` — owner only; min 2 chars; ILIKE escape (`%`, `_`, `\`); excludes owner + existing co-admins + null `line_user_id`; **returns only `{id, display_name}` — `line_user_id` NOT selected (PII; server-side guest filter only)**; limit 20; `excludeIds` always non-empty (has `session.profileId`)
  - `ClubAdmin`, `ClubProfileSearchResult` types exported
- **`ClubCoAdminControls`** (`src/components/club/club-co-admin-controls.tsx`) — client; Popover + Command combobox, 250ms debounce; toast on add error incl. missing LINE account
- **Club detail page**: JOIN `!club_admins_user_id_fkey` (explicit FK name — 2 FKs to profiles); fetch parallel; `canManage = isOwner || isCoAdmin`; `SortablePlayerList` prop `isOwner` → `canManage`

### เช็คอิน

- **DB**: `club_players.checked_in_at timestamptz nullable`
- **Action**: `toggleCheckInAction({ club_id, player_id })` — permission check **ก่อน** player fetch; owner+co-admin เท่านั้น (`assertCanManageClub`) — **ผู้เล่นทั่วไปเช็คอินเองไม่ได้**
- **`CheckInButton`** (ใน `sortable-player-list.tsx`):
  - `canToggle = canManage` — เจ้าของ/co-admin มีปุ่ม; ผู้เล่นทั่วไปเห็นแค่ badge read-only
  - checked in → สีเขียว "พร้อม"; ยังไม่ → "เช็คอิน" outline
  - Row highlight: `border-green-500/30 bg-green-500/5`
- **Count badge**: "X/N พร้อม" ในหัว section (เมื่อ `checkedInCount > 0`)

### ค่าใช้จ่ายแบบแยกรายการ

- **DB**: `club_expenses` — `id, club_id (FK → clubs CASCADE), label text, amount numeric(10,2), payer_player_ids uuid[] NOT NULL default '{}', created_at` (migration `20260606000200_club_expense_payers`). `payer_player_ids` = designated payers: ว่าง `{}` → หารทุกคน (legacy even-split); ไม่ว่าง → หารเฉพาะ club_players ที่ระบุ. **ต่างจาก cost-split** (court/shuttle หารตามเวลา/เกม) — expense = ค่าใช้จ่ายที่ผู้จัดออกให้ก่อน เก็บเฉพาะคนที่กำหนด [[s1-433]]
- **Actions** (owner/co-admin via `assertCanManageClub`): `addExpenseAction`, `updateExpenseAction`, `deleteExpenseAction`; `ClubExpense` type (+`payer_player_ids: string[]`) exported; `setTotalCostAction` ยังคงไว้ (legacy). `ExpenseSchema` zod validate + `validClubPayerIds()` helper กรอง id ที่อยู่ใน club จริง
- **`ExpenseManager`** (`src/components/club/expense-manager.tsx`) — client:
  - Shared `ExpenseForm` (TanStack Form + `z.number()`) สำหรับทั้ง add และ edit
  - Hover-reveal edit/delete buttons; aria-label ครบ
  - Payer checkbox multi-select ต่อ expense (ว่าง = ทุกคน) + per-expense payer sub-line
  - `PlayerRollup` table — รวมยอดต่อหัวจาก payer assignment (ceil per head)
  - `router.refresh()` หลัง mutate
- **Club detail page**: fetch parallel; รวมยอด `รวมค่าใช้จ่าย {total}` ใน info grid (ตัด per-person averaged line ทิ้ง — misleading เมื่อมี designated payers); fallback `total_cost` (legacy) ถ้า expenses ว่าง; ส่ง `players` prop เข้า `ExpenseManager`

### Cost Split (court + shuttle) — ✅ DONE

หาร 2 ก้อนแยกอิสระ (ดู design เต็มใน `## Todo`):
- **DB** `clubs`: `court_fee` · `court_split` (`even`|`by_time`) · `shuttle_split` (`even`|`per_match`|`per_player`|`by_time`, CHECK `clubs_shuttle_split_check`) · `shuttle_price` (**ราคา/ลูก** — ใช้ทุก mode) · `shuttle_hourly` (`integer[]` default `'{}'` — จำนวนลูก/ชั่วโมง index ตาม `sessionHourSlots`; ใช้เฉพาะ `shuttle_split=by_time`, migration `20260623000100_club_shuttle_hourly`) · `shuttle_total` (`integer` NOT NULL default 0, CHECK `>= 0` `clubs_shuttle_total_nonneg` — จำนวนลูกรวมกรอกเองสำหรับ `shuttle_split=even`; 0 = นับจาก `shuttles_used` ของแมตช์ (การเล่นจริง), migration `20260708000100_club_shuttle_total_even`) · `court_gap_policy` (`spread`|`owner`|`ignore`). `shuttle_fee` = **DROPPED แล้ว** (migration `20260607001200`, introspect-confirmed 2026-06-10). `club_players`: `start_time`/`end_time` (time, null = ช่วงก๊วนเต็ม) · `games_played` · `last_finished_at`.
- **Shuttle model (redesign 2026-06-07):** ค่าลูก = ราคา/ลูก × ลูกที่ใช้ (`club_matches.shuttles_used`), ทุก mode derive จาก matches (ไม่ใช้คิว → ค่าลูก = 0). **even** (หารเท่า) = `จำนวนลูก × price ÷ N ทุกคนเท่ากัน` — จำนวนลูก = `clubs.shuttle_total` เมื่อ owner กรอกเอง (>0) ไม่งั้น `Σ shuttles ทั้งหมด` จากแมตช์ [**even manual count เพิ่ม 2026-07-08 v0.21.0**: ช่องกรอกจำนวนลูกรวมในโหมดหารเท่า, 0/ว่าง = auto นับจากการเล่นจริง, ใช้บิลได้แม้ไม่เปิดคิว; คอลัมน์ "จำนวนลูกที่ใช้" + footer โชว์ยอด override เต็มทุกคน — mirror by_time (`computePlayerUsage` + `totalShuttlesUsed` ใน `cost-summary.ts`); ปุ่มโหมดเรียงใหม่ หารเท่า·ตามชั่วโมง·ต่อลูก·ต่อแมตช์]; **per_match** (ตามแมตช์) = `Σ ต่อแมตช์ (shuttles × price ÷ คนในแมตช์)`; **per_player** (ต่อคน ไม่หาร) = แต่ละคนในแมตช์จ่ายเต็ม `shuttles × price` (ไม่หารด้วยจำนวนคน). by_games เดิม = per_match → merge (migration `20260607000400` drop CHECK เก่า `(even,by_games)` ที่บล็อก per_match [latent bug ของ commit 95488da] → migrate by_games→per_match → re-add). `20260607000600` เพิ่ม per_player → CHECK `(even,per_match,per_player)`. **by_time (เพิ่ม 2026-06-23, v0.13.0):** สำหรับก๊วนที่กรอกลูกเป็น "ยอดรวม" ไม่ได้ลงต่อแมตช์ — owner กรอกจำนวนลูก/ชั่วโมง (`clubs.shuttle_hourly[]`), แต่ละ slot 1 ชม. = `count × price` หารเฉพาะคนที่อยู่ **ครบทั้ง slot** (present rule = เกณฑ์เดียวกับ `HourlyHeadcount` → เลขนับหัว = จำนวนคนที่หาร) แล้วรวมทุก slot; slot ที่มีลูกแต่ไม่มีใครอยู่ครบ → fallback เกลี่ยให้ผู้มาเล่นทั้งหมด (กันเงินหาย); ไม่ใช้ `matches`/queue. แก้ปัญหา even ที่หารลูกทั้งหมดให้ทุกคนเท่ากัน (คนเล่นชั่วโมงเดียวโดนหารชั่วโมงที่ไม่ได้เล่น). CHECK → `(even,per_match,per_player,by_time)`.
- **Pure** `src/lib/club/cost-split.ts` `computeClubSplit(input)`: court `by_time` = segment ตามช่วงผู้เล่น; shuttle `SplitInput` รับ `shuttlePrice?` + `matches?: SplitMatch[]` + `shuttleHourly?: number[]` (mode by_time); helper `sessionHourSlots(start,end)` แตก window เป็น slot 1 ชม. (cross-midnight aware) ใช้ร่วม math+UJ; even/per_match/per_player/by_time ตามบน; whole-baht rounding = **ปัดขึ้น (ceil) ทุกคน** (`ceilBucket`, เปลี่ยน 2026-06-09 จาก round-nearest+remainder→คนจ่ายมากสุด ซึ่งทำให้คนเวลาเท่ากันต่างกันได้หลายบาท เช่น 104 vs 107) → คนแชร์เท่ากันได้เลขเท่ากัน, ยอดรวมอาจ over-collect เล็กน้อย (by design — บิลถูกคุ้มเสมอ ไม่ขาด), epsilon `1e-9` กัน float dust ไม่ให้ integer share เด้งขึ้นบาท. **Cross-midnight (2026-06-09):** session ข้ามเที่ยงคืน (เช่น 21:00→01:00) ทำ `sessionEnd < sessionStart` → เดิม `sessionMin` ติดลบ → guard ตัดค่าสนามทิ้งทั้งก้อน. แก้: เมื่อ `s1 < s0` extend `s1 += 1440` + helper `place()` เลื่อนเวลาผู้เล่นช่วงเช้ามืด (`< s0`) ไป +24h บน timeline เดียวกัน; `s1 === s0` คงเป็น zero-window (ไม่เก็บค่าสนาม) ไม่ใช่ 24h เต็ม; non-crossing byte-identical. **by_time shuttle** ใช้ timeline + `place()` ชุดเดียวกันแต่ตัดสินจาก "อยู่ครบ slot" ต่อ 1 ชม.; cost-split 49 vitest (+6 cross-midnight, +12 by_time/sessionHourSlots).
- **Actions**: `updateClubCostConfigAction` (`CostConfigSchema` shuttle_split `even`|`per_match`|`per_player`|`by_time` + shuttle_price + `shuttle_hourly` `int[]≥0 max 48` + `shuttle_total` `int 0..9999` (even-mode manual count, 0 = auto) ; `shuttle_fee` ลบจาก schema แล้ว). match-lifecycle actions (start/finish/cancel/shuttles/delete) ใช้ `loadClubMatchForManage()` helper ร่วมกัน. expense add/update/delete = `assertCanManageClub` (owner + co-admin). lock create = RPC `create_club_locked_pair` (club-row lock ปิด TOCTOU); finish RPC decrement lock เฉพาะคู่ฝั่งเดียวกัน.
- **UI**: `club-cost-manager.tsx` (court fee + gap policy + **ค่าลูก (บาท)** = shuttle_price + toggle หารเท่า/ต่อลูก/ต่อแมตช์/**ตามชั่วโมง**; เมื่อเลือก "ตามชั่วโมง" โผล่ grid กรอกลูก/ชม. ต่อ slot พร้อมป้ายนับหัว (`hourlySlots` prop = `buildHourlyShuttleSlots(club,players)` จาก page) + ยอดรวม; state `shuttleHourly` dense ตาม slots กัน sparse-NaN; **collapsible** default ยุบ) · `club-cost-breakdown.tsx` (per-player table; รับ `matches` + `expenses`; `hasShuttle` gate = `shuttle_price > 0` ทุก mode; `SHUTTLE_SPLIT_LABEL` ตรง UI) · session editor + partial-window label + `hourly-headcount.tsx` ใน `sortable-player-list`. **public-view** `toPublicClub` redact `shuttle_hourly: []` (cost input). `hourly-headcount.tsx` ใช้ `buildHourlyShuttleSlots` ร่วม (helper เดียวกับ by_time → นับหัว grid = จำนวนคนที่หาร, cross-midnight aware). by_time usage column: `computePlayerUsage`/`computeClubCostRows.totalShuttlesUsed` อ่านจาก `shuttle_hourly` (ไม่ใช่ matches) → คอลัมน์ "ลูกที่ใช้" ตรงกับฐานค่าลูก. i18n +7 keys `club.costManager.*` (splitByHour/shuttleDescByHour/hourlyTitle/hourlyTotal/hourlyNoSlots/hourlyPeople/hourlyUnit) + `club.costBreakdown.splitByHour` (th/en parity).
- **Personal expense + discount (2026-06-07):** `computeExpenseShares(playerIds, expenses)` (pure, 5 vitest) = ต่อคนจาก `club_expenses` (ceil-per-head ตาม payer_player_ids; ว่าง=ทุกคน) — "ค่าใช้จ่ายส่วนบุคคล" (เปลี่ยนชื่อ card จาก "ค่าใช้จ่าย"). `club_players +discount numeric` (migration `20260607000800`). breakdown เพิ่ม column **ค่าใช้จ่ายส่วนบุคคล** + **ส่วนลด** (input ต่อคน, canManage → `updateClubPlayerDiscountAction`) + **รวม** = `max(0, court+shuttle+expense−discount)`. page guard cost-breakdown โชว์เมื่อมี court/shuttle **หรือ** expenses/discount. `renameClubGuestAction` — แก้ชื่อ guest (profile_id null) ผ่าน Pencil ใน roster (canManage).

### Payment Collection (PromptPay QR + paid tracking) — ✅ DONE (2026-06-17)

เก็บเงินตอนก๊วนจบแบบ **manager-driven** (ผู้เล่นเดินมาสแกนที่เครื่อง owner/co-admin → กดเช็ค "จ่ายแล้ว"). ลิงก์ public self-pay = out of scope (เฟสหลัง).
- **DB** (migration `20260617000200_club_payments`): `clubs` +`promptpay_id` (เบอร์มือถือ/เลขบัตร ปชช., null=ยังไม่ตั้ง) +`promptpay_name` (ชื่อผู้รับ) +`promptpay_qr_image` (Storage URL — Phase 1b). `club_players` +`paid_at timestamptz` (null=ยังไม่จ่าย, mirror `checked_in_at`) + partial index `idx_club_players_paid (club_id) WHERE paid_at IS NOT NULL`. **`toPublicClub`/`toPublicPlayer` strip ทั้ง 4 ฟิลด์** (เงิน → ไม่ ship หน้า public; +2 vitest).
- **Phase 1b — อัปโหลดรูป QR ✅ DONE (2026-06-17):** migration `20260617000300_club_qr_bucket` สร้าง Storage bucket `club-qr` (public, limit 1MB, mime png/jpeg/webp). actions `uploadClubPromptPayQrAction({clubId, dataUrl})` (decode base64 → upload path `{clubId}/promptpay` upsert → เก็บ public URL +`?v=` cache-bust ใน `promptpay_qr_image`) + `removeClubPromptPayQrAction` (best-effort ลบ object + clear column). UI: `PromptPayConfig` เพิ่มปุ่มอัปโหลด (hidden file input → FileReader→dataUrl) + preview + ลบ. **ลำดับความสำคัญ QR ต่อคน:** เบอร์ valid → generate QR ฝังยอด (priority); ไม่มีเบอร์แต่มีรูป → แสดง `<img>` + ข้อความ "ไม่ฝังยอด แจ้งโอน ฿X เอง"; ไม่มีทั้งคู่ → hint ให้ตั้งค่า. คีย์ `actions.club.invalidQrImage` + `club.payment.{orDivider,uploadBtn,uploading,uploadInvalid,uploadedQr,removeQr,qrImageHint}`.
- **Pure** `src/lib/club/promptpay.ts` — `buildPromptPayPayload(id, amount?)` สร้าง EMVCo string (tag00/01/29[AID `A000000677010111`]/53[THB 764]/54[amount→dynamic]/58[TH]/63[CRC16-CCITT-FALSE]); มือถือ→`0066…`, เลขบัตร 13 หลักใช้ตรง; `amount>0` → dynamic QR (แอปธนาคารเด้งยอด). `isValidPromptPayId` (มือถือ 10 / บัตร 13 / e-wallet 15) · `detectPromptPayType` · `crc16ccitt` (canonical check `"123456789"→"29B1"`). 8 vitest.
- **Actions** `src/lib/actions/club-payments.ts` (`assertCanManageClub`): `updateClubPaymentConfigAction(clubId, {promptpay_id?, promptpay_name?})` (validate + clear-on-empty) · `toggleClubPlayerPaidAction({clubId, playerId})` (flip `paid_at` now()↔null) · `resetAllPaidAction(clubId)` (เคลียร์ทั้งก๊วน, idempotent `.not("paid_at","is",null)`). action key `actions.club.invalidPromptPay`.
- **UI** `club-payment-collector.tsx` (manager-only, ในแท็บ "ค่าใช้จ่าย" ต่อท้าย breakdown) — **แบบ C ใบเสร็จ+progress** (user เลือกจาก 3 mockup ใน `design/club-pay-mockup.html`): การ์ดตั้งค่าผู้รับ PromptPay (collapsible, `react-qr-code`) + แถบสรุป "เก็บแล้ว X/N · ฿collected/฿total" + progress bar + per-player accordion (breakdown court/ลูก/expense/ส่วนลด/รวม + QR ฝังยอด inline + toggle จ่ายแล้ว/ยังไม่จ่าย optimistic) + ปุ่มรีเซ็ตสถานะจ่าย. ยอดต่อคนจาก `computeClubCostRows` (แหล่งเดียวกับ breakdown — ไม่ drift). namespace `club.payment.*` (30 keys th/en).
- **Centre QR logo + global admin ✅ DONE (2026-06-18):** QR ที่ generate จากเบอร์มีโลโก้กลาง (default = `public/thaiqr-logo.png` ของ Bank of Thailand; EC level **H** → สแกนได้). `GeneratedQr({value,size,logoUrl})` (logoUrl null = ไม่มีโลโก้); กด QR → Dialog ขยาย (240px) ทั้ง generate + รูปอัปโหลด.
  - **Global, site-owner only:** migration `20260618000100` (`profiles.is_site_admin bool` + ตาราง singleton `app_settings{qr_logo_enabled, qr_logo_url}` id=1) + `20260618000200` (bucket `app-assets`). helper `isSiteAdmin()` (`src/lib/auth/site-admin.ts`); reader `getAppSettings()`+`resolveQrLogoUrl()` (`src/lib/app-settings.ts`, default `DEFAULT_QR_LOGO`). actions `src/lib/actions/app-settings.ts`: `setQrLogoEnabledAction`/`uploadQrLogoAction`/`removeQrLogoAction` (ทั้งหมด gate `isSiteAdmin`). หน้า `/admin` (`src/app/(app)/admin/page.tsx`, `force-dynamic`, non-admin → `notFound()`) + `AdminQrLogoManager` (เปิด/ปิด + อัปโหลด/preview/รีเซ็ต). club page ส่ง `qrLogoUrl={resolveQrLogoUrl(appSettings)}` → `ClubPaymentCollector` → `PlayerReceipt` → `GeneratedQr`. ลิงก์ /admin โผล่ในหน้า `/settings` เฉพาะ site owner. namespace ใหม่ `admin` (14 keys th/en) + `actions.admin.{notSiteAdmin,invalidImage}`.
- **Per-player payment slip (ส่งเข้า LINE) ✅ DONE (2026-06-18):** `ClubSlipShare` (`club-slip-share.tsx`, manager-only, ในแท็บ "ค่าใช้จ่าย" ต่อท้าย `ClubPaymentCollector`) — เลือกผู้เล่น (checkbox, default ติ๊กเฉพาะคน `paid_at=null` + select-all + นับจำนวน) → กด "ส่งสลิป" เปิด Dialog แสดง `SlipCard` (การ์ดโมเดิร์น หัวเขียว `#2e7d4f` กว้าง 360px, **สี explicit ทั้งหมด** กัน dark-mode bleed ตอน capture) = breakdown (court/ลูก/expense/ส่วนลด/รวม) + QR ฝังยอด (`buildPromptPayPayload(id,total)`; fallback รูป QR อัปโหลด + ข้อความ "โอน X บาท") → **แชร์** ผ่าน Web Share API (`navigator.share({files})` → LINE บนมือถือ) หรือ **ดาวน์โหลด PNG** (fallback เมื่อ `!navigator.canShare`) + ปุ่ม batch "ดาวน์โหลดที่เลือกทั้งหมด" (off-screen render ทีละคน). รูปสร้างด้วย **`modern-screenshot`** `domToBlob({scale:3,backgroundColor:"#ffffff"})` (warm-up double-call + `await document.fonts.ready` กันฟอนต์ Anuphan หาย). ยอดจาก `computeClubCostRows` (แหล่งเดียวกับ breakdown — ไม่ drift). `GeneratedQr` ถูก **extract** → `src/components/club/generated-qr.tsx` (collector ใช้ react-qr-code SVG). **สลิปใช้ `SlipQr` = QR raster** (`qrcode.toDataURL`→`<img>`, EC level H, โลโก้กลาง 26%) เพราะ `modern-screenshot` (foreignObject) ถ่าย inline SVG ออกมา**ว่าง** (เจอจาก live-smoke). pre-render blob ตอนเปิด Dialog (รักษา iOS Web Share user-activation). namespace ใหม่ `club.slip.*` (15 keys th/en) + reuse `club.payment.col*`/`gamesSuffix`. +dep `modern-screenshot` + `qrcode`.
  - **รวมเข้า "เก็บเงิน" panel เดียว (2026-06-21):** การ์ด `ClubSlipShare` แยก (หัวข้อ "ส่งสลิปเรียกเก็บเงิน") ถูก**ยุบรวมเข้า `ClubPaymentCollector`** — `club-slip-share.tsx` **ลบทิ้ง**, ชิ้นส่วนที่ใช้ซ้ำ (`SlipCard`/`SlipDialog`/`SlipQr` + helper `renderSlipBlob`/`shareOrDownload`/`sanitizeFilename`) ย้ายไปไฟล์ใหม่ `src/components/club/club-slip-card.tsx`. ในใบเสร็จต่อคน (`PlayerReceipt`) เพิ่มปุ่ม **"ส่งสลิป"** ข้างปุ่มติ๊กจ่าย → เปิด `SlipDialog`; แถบสรุปเพิ่มปุ่ม batch **"ดาวน์โหลดสลิปทั้งหมด"** (off-screen render ทุกคน payable, ข้าง "เรียกเก็บผ่าน LINE"). ตัด UI เลือกผู้เล่น (checkbox/select-all) ทิ้ง — ส่งรายคนผ่านปุ่มในใบเสร็จ + batch = ทุกคน payable. dead i18n keys `club.slip.{sectionTitle,sectionHint,selectAll,selectedCount}` ลบจาก th+en (`downloadAllButton` → "ดาวน์โหลดสลิปทั้งหมด"). warm `react-qr-code` import + pre-render blob + SlipQr raster workaround คงเดิมทุกจุด. tsc 0 · vitest 706 · build OK.
- **Collapse default flip (2026-06-18):** `club-cost-manager.tsx` + `club-locked-pairs.tsx` เปลี่ยน `useState(true)`→`useState(false)` → การ์ด "ตั้งค่าแบ่งค่าใช้จ่าย" + "ล็อคคู่" **default ยุบ** (ลด noise หน้าจอ; กดขยายเองได้).
- gates: tsc 0 · vitest 654/654 · next build pass · **live-smoke PASS** (Playwright owner-cookie net-zero — QR render + ยอด ฿140 ตรง computeClubCostRows + console 0 err; live-smoke จับ+แก้ QR-blank bug).

### Group billing via LINE (push เข้ากลุ่มที่ผูกไว้) ✅ LIVE 2026-07-12 (v0.31.0) · 🐞 mention textV2 fix (v0.31.1, branch — pending deploy)

โพสต์บิลเข้า **กลุ่มไลน์ที่ผูกกับก๊วน** แยกข้อความ **ตามยอด**: แต่ละยอด = text message แท็ก (@mention) เฉพาะผู้จ่ายยอดนั้น + รูป QR พร้อมเพย์ฝังยอด (เช่น 170→@bee @pang, 90→@bank @boy). **outbound ล้วน — ไม่รับสลิป** (ไม่ใช่ฟื้น slip-verify ที่ลบไป); เจ้าของยังกด "จ่ายแล้ว" เอง.
- **ข้อจำกัด LINE ที่กำหนดดีไซน์:** บับเบิลเดียวใส่ทั้ง @mention + รูปไม่ได้ → ต่อยอด = **1 push, `messages: [textV2(substitution mentions), image(QR)]`**. mention สูงสุด 20/ข้อความ (เกินนั้น chunk, clamp 5 msg/push → `overflow`).
- **⚠️ send-mention ต้องใช้ `type:"textV2"` + `substitution:{key:{type:"mention",mentionee:{type:"user",userId}}}` เท่านั้น** (placeholder `{key}` ในข้อความ). format เดิม `type:"text"` + `mention.mentionees` (index/length) เป็น **ฝั่งรับ webhook** — LINE รับ 200 แต่ **drop เงียบ → ตัวดำ ไม่เด้ง** (นี่คือบั๊ก v0.31.0, แก้ v0.31.1). textV2 แสดงชื่อ LINE จริงอัตโนมัติ (ไม่ส่ง @ชื่อเอง). **โชว์เฉพาะ LINE มือถือ ≥14.17.0 — PC ไม่รองรับ.** ยืนยันสด: ยิงตรง textV2 → user เห็นสีฟ้า+เด้งจริง (2026-07-12).
- **groupId มาทาง webhook ทางเดียว** (LINE ไม่มี API list group) → **เพิ่ม inbound webhook ขั้นต่ำเฉพาะผูกกลุ่ม** `src/app/api/line/webhook/route.ts`: verify sig → `after()` ack 200 → group text ที่ match `^ผูกก๊วน <join_token>$` → set `clubs.line_group_id = source.groupId` (reuse `join_token` เดิม; reply ยืนยันในกลุ่ม; unique index กันกลุ่มผูกซ้ำก๊วนอื่น). **นี่กลับทิศ decision เดิม "no new webhook"** เพราะการแท็กคนในกลุ่มต้องมี groupId ที่ได้จาก webhook เท่านั้น — scope แคบ (ผูกกลุ่มอย่างเดียว ไม่แตะรูป/สลิป).
- **Schema:** migration `20260712000100_club_line_group_bind` — `clubs.line_group_id text` + partial-unique `uniq_clubs_line_group_id ... WHERE line_group_id IS NOT NULL` (1 กลุ่ม/1 ก๊วน). `Club` type +`line_group_id`; `toPublicClub` redact เป็น null (+vitest). **✅ applied prod 2026-07-12.**
- **Pure core** `src/lib/club/group-billing.ts`: `bucketBillsByAmount` (จัดกลุ่มตามยอด → reachable/unreachable), `buildGroupBillText` (**textV2 + `substitution` mentions**; ไม่ใช้ displayName ใน tag — LINE render ชื่อจริง), `buildGroupBillMessages` (chunk 20 + clamp 5 + `overflow`), `buildQrImageMessage`. **10 vitest** reproduce เคสจริง 170/@bee/@pang + 90/@bank/@boy + regression guard กันกลับไป format เก่า.
- **Helper** `pushMessagesToGroup(groupId, messages)` ใน `line-club.ts` (Push API `to:` รับ group id ตรงๆ).
- **Action** `pushGroupBillsAction({clubId, slipUrlByAmount})` ใน `club-billing.ts`: reuse `computeClubCostRows` → resolve `line_user_id` → bucket → **หยิบ slip URL จาก `slipUrlByAmount[String(amount)]`** (client render+upload ล่วงหน้า; ไม่ gen QR ฝั่ง server แล้ว) → `buildGroupBillMessages(bucket,{clubName,slipUrl,dateStr})` → `pushMessagesToGroup(line_group_id)` → stamp `bill_amount`+`bill_pushed_at` ทุกคนในบัคเก็ตที่ส่งสำเร็จ; **บัคเก็ตที่ไม่มี slip URL → ข้าม (`skippedNoSlip`) ไม่ push ไม่ stamp**; audit `group_bills_pushed`. คืน `{amountsPushed, playersTagged, skippedNoLine, skippedNoSlip, overflow}`. keys `actions.club.{noLineGroup,noPayable}`. (v0.32.0: QR เปล่า → สลิปรูปเต็มใบ, variant `group` = ยอดรวม+QR เท่านั้น)
- **UI:** ปุ่ม "เรียกเก็บเข้ากลุ่มไลน์" (`club-payment-collector.tsx` — Users icon, disabled เมื่อยังไม่ผูกกลุ่ม/ไม่มีคนจ่าย, tooltip) + section "ผูกกลุ่มไลน์กับก๊วน" (`club-link-controls.tsx` — bound state / คำสั่ง `ผูกก๊วน <token>` + copy / prompt gen token). page ส่ง `lineGroupBound={!!club.line_group_id}`. keys `club.payment.pushGroup*` + `club.linking.bindGroup*`.
  - **(v0.33.0) ยกเลิก/ย้ายกลุ่ม:** webhook รับแค่ `ผูกก๊วน` ไม่มีคำสั่ง unbind → เพิ่ม action `unbindClubLineGroupAction(clubId)` (`club-linking.ts`; `assertCanManageClub` → set `line_group_id = null` → audit `line_group_unbound` → revalidate; err key `actions.club.unbindGroupFailed`). UI (`club-link-controls.tsx`) bound state เดิมโชว์แค่ badge → ตอนนี้โชว์ badge + คำสั่ง `ผูกก๊วน <token>` (helper `BindCommandRow`, reuse กับ unbound state) ใต้ hint `bindGroupRebindHint` (ก๊อปไปโพสต์ในกลุ่มใหม่ = ย้ายกลุ่ม; webhook เขียนทับ groupId เดิม) + ปุ่ม `unbindGroupBtn` (Link2Off, destructive) เปิด confirm Dialog (`unbindConfirm*`). local `bound` state flip ทันทีหลัง unbind. keys `club.linking.{bindGroupRebindHint,unbindGroupBtn,unbindGroupTip,unbindConfirmTitle,unbindConfirmDesc,unbindConfirmBtn,unbindCancelTip,toastUnbound}` (th/en parity 938=938). bound-แต่ไม่มี token → reuse `bindGroupNeedToken` hint. dialog footer ปุ่มหุ้ม Tooltip (ตาม convention `LinkConfirmDialog`).
- gates: **tsc 0 · vitest 835 (group-billing 10) · i18n parity ok**. **prereq ครบแล้ว:** migration applied prod ✅ · Messaging channel + `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`/`_SECRET` ✅ · bot ในกลุ่ม ✅ · LINE Login/Messaging **provider เดียวกัน** ✅ · ผู้เล่น link LINE ✅.
  - **🔧 REWORK v0.38.0 — บิลรวม text-list + QR เปิด (แทน bucket-per-amount):** grill lock (2026-07-15) — แทนที่ปุ่มเดิม; ส่ง **ข้อความเดียว** เป็น list เลขลำดับ `1. {name} {amount}` (คนเชื่อม LINE → @mention textV2, guest → ชื่อธรรมดา) + **QR พร้อมเพย์ไม่ระบุยอด** (`buildPromptPayPayload(id)` ไม่ใส่ amount) เป็นรูปปิดท้าย; header `ค่าก๊วน {club} · {date}` + ชวนสแกน. **Pure core rewrite** `group-billing.ts`: ลบ `bucketBillsByAmount`/`buildGroupBillText`/`buildGroupBillMessages` → `buildGroupBillLines` (sort amount desc, number 1..N, `mentioned=Boolean(lineUserId)` — empty-string id ไม่กิน mention slot) + `formatBillAmount` (trim .0) + `buildGroupBillListMessages` (chunk **20 mention/ข้อความ + cap 40 บรรทัด/ข้อความ** `MAX_LINES_PER_MESSAGE` กัน guest-only roster ยาวเกิน LINE ~5000  char, plain ไม่กินโควตา mention, numbering ต่อเนื่อง, header แรก, **clamp 5 msg/push ก่อน compose** → prompt+QR อยู่ chunk สุดท้ายที่เหลือจริง, คืน `sentPlayerIds` = คนที่ line เข้าไปใน push จริง) + `buildImageMessage`. **19 vitest** (mention+plain, chunk, plain-not-counted, guest-only line-cap split, overflow keeps QR+prompt+sentPlayerIds, empty-string→un-mentioned, no-QR text-only, brace-strip, empty). **Action** `pushGroupBillsAction({clubId, qrImageUrl})` (เดิม `slipUrlByAmount`): payable→`buildGroupBillLines`→`buildGroupBillListMessages`→push **ครั้งเดียว** (fail→`actions.club.groupPushFailed`)→stamp `bill_amount`+`bill_pushed_at` **เฉพาะ `sentPlayerIds`** (group by amount; overflow-dropped ไม่โดนแสตมป์ว่าส่งแล้ว)→audit (detail มี `overflow (dropped N)` เมื่อตัด). คืน `{billed,mentioned,overflow}`. **UI** `group-bill-dialog.tsx` (ใหม่): preview ก่อนส่ง (reuse `buildGroupBillLines` โดย client ใส่ `lineUserId: hasLine?"linked":null` — id จริงเป็น server-only) — โชว์ header (**date locale pin "th"** ให้ตรง header ที่ server ส่ง) + list + badge LINE + QR (GeneratedQr open payload / รูปอัป / no-QR note) + นับ + เตือน chunk; ยืนยัน → render open-QR PNG (`QRCode.toDataURL`) + `uploadBillSlipAction(kind:"amount",key:"open-qr")` → `pushGroupBillsAction`. `club-payment-collector.tsx` ปุ่มเดิมเปิด dialog (disabled เมื่อ `unpaidForGroupBill.length===0`; ลบ `pushGroupBillsWithSlips` bucket/slip). QR source: เบอร์พร้อมเพย์ก่อน → รูปอัป → text-only. keys `club.payment.groupBill*` (th/en). **Pre-merge review fix (ship-check 2026-07-15):** แก้ 6 บั๊กที่ 3-agent bug-hunt เจอ — overflow-dropped players โดนแสตมป์ (P2), scan prompt หายตอน overflow (P2), preview date ใช้ locale admin ไม่ตรง server-th (P1), `mentioned` ใช้ `!=null` (P3), guest-only ไม่ split (P3), ปุ่มเปิดตอน paid หมด (P3). ยังไม่ deploy.

### Self-service LINE link ผ่าน keyword ในกลุ่ม ✅ v0.34.0 (branch `feat/club-line-self-link-keyword` — code done, PR + live-smoke pending) · wayfinder map #49

fast-path ให้ผู้เล่น **เชื่อม LINE เองในกลุ่มที่ผูกก๊วนไว้ ควบคู่** manager pool เดิม (ไม่แทนที่). ผู้เล่นแท็กบอท + พิมพ์ `เชื่อมไลน์ <ชื่อในโพย>` → เจอ guest row เดียวชื่อตรง + `profile_id IS NULL` → **auto-link ทันที** + reply ยืนยันในกลุ่ม; **ทุกเคสไม่สวย** (กำกวม/ถูกจอง/ไม่เจอ) → หย่อนเข้า `club_link_requests` pending ให้ manager (insert-when-absent — ไม่ปลุก request ที่ manager dismiss ไว้; ไม่มี disambiguation ในแชท).
- **Webhook** `src/app/api/line/webhook/route.ts`: refactor `after()` loop → dispatcher `handleEvent` → `handleBind` (`ผูกก๊วน` เดิม) | `handleSelfLink`. self-link **ต้อง @mention บอท** (ตรวจ `message.mention.mentionees[].isSelf === true`) — ลด false-trigger; bind แยกด้วย `BIND_RE` ก่อน (mutually exclusive). orchestration `resolveSelfLink` อยู่ไฟล์เดียวกัน.
- **Pure core** `src/lib/club/line-self-link.ts`: `parseSelfLinkCommand(text, mentionedSelf, mentionees)` (strip mention ด้วย offset UTF-16 → จับ `^เชื่อม[ไลน์|line]? <name>`; คืน `link|usage|null`), `classifyRosterMatch(rows, name)` → `unique|ambiguous|taken|not_found` (match ทุกแถวก่อนเช็ค `profile_id`), `normalizeRosterName`, `stripMentions`. **17 vitest** (`__tests__/line-self-link.test.ts`).
- **Identity/reconcile (research #50):** จับ `source.userId` จาก **Messaging webhook** = userId ที่ group @mention ใช้ได้พอดี → `upsertLineProfile({userId, displayName, pictureUrl})` (displayName จาก `getGroupMemberProfile(groupId, userId)` = `GET /v2/bot/group/{groupId}/member/{userId}`, **ไม่ต้อง add friend** ต่างจาก `/v2/bot/profile/{userId}`). same-Provider (prereq ✅) → dedup กับ Login row ผ่าน unique `profiles.line_user_id`. auto-link update ใช้ `.is("profile_id", null)` + partial unique `uniq_club_players_profile` → **race-safe + ไม่ทับ link เดิม**; ไม่มี `source.userId` (ไม่ใช่ iOS/Android) → reply retry-in-app, ไม่เขียน DB.
- **Helper ใหม่** `getGroupMemberProfile(groupId, userId)` ใน `line-club.ts`. **audit** `player_linked_keyword` / `link_requested_keyword` (actor = profile.id, actor_name = LINE displayName). reply ไทย hardcoded (LINE bodies คงเป็นไทย). **ไม่มี migration** (reuse `club_players.profile_id` + `club_link_requests` + `uniq_club_players_profile` เดิม).
- gates: **tsc 0 · vitest 852 (line-self-link 17) · next build ok**. ⏳ **live-smoke** (โพสต์ keyword ในกลุ่มจริง เคสสวย+ไม่สวย + เช็ค @mention เด้ง = ปิด loop same-Provider E2E ที่ยังไม่เคยพิสูจน์) + PR develop→master รอทำ. research #50 / build #51 / ship #52.
- **สถานะ deploy:** v0.31.0 (format เดิม) live บน prod **แต่แท็กไม่เด้ง** (ตัวดำ). fix v0.31.1 (textV2) อยู่ branch `fix/club-line-group-mention-textv2` — **รอ merge→prod**. textV2 ยืนยันสดแล้วว่าเด้งจริง (ยิงตรง LINE API, user เห็นสีฟ้า). ปุ่มในแอปจะแท็กเด้งจริงหลัง deploy v0.31.1.

### Auto-billing via LINE — ❌ INBOUND SLIP-VERIFY REMOVED 2026-07-09 (v0.22.0)

> **ลบระบบ "ยืนยันสลิปขาเข้า" ทั้งหมด (PR #23):** คิวตรวจสลิป (`club-slip-review`), auto-verify byok EasySlip/SlipOK (`slip-verify.ts`), config โหมด (`billing-verify-settings.ts` / `club-slip-verify-config.tsx`), actions `confirmSlipAction`/`rejectSlipAction`/`updateClubBillingVerifySettingsAction`, และการรับรูปสลิปใน LINE webhook (`route.ts` เหลือแค่ verify-signature + ack 200). เจ้าของก๊วนตรวจ/กด "จ่ายแล้ว" เองผ่าน `toggleClubPlayerPaidAction` แทน. **ยังคง:** push บิล LINE (`pushClubBillsAction`), PromptPay QR, ใบเสร็จ `SlipCard` ขาออก + ดาวน์โหลด. dead i18n keys ลบแล้ว (`club.payment.review*`/`verify*`, `actions.club.billingVerify*`). **DROP schema done 2026-07-09:** Storage API ลบ bucket `payment-slips` (0 objects at preflight) แล้ว migration `20260709001634_drop_club_slip_verify_schema` ลบตาราง `club_payment_slips` + `club_billing_secrets`, คอลัมน์ `clubs.billing_verify_settings`, และ field `billing_verify_settings` บน `Club` type. เนื้อหา Phase 1/2/3 ด้านล่างเก็บเป็นบันทึกประวัติเท่านั้น.

### (ประวัติ) Auto-billing via LINE — code DONE (Hybrid: บอท push บิล → ผู้เล่นส่งสลิป → verify อัตโนมัติ + fallback เจ้าของยืนยัน)

แผนเต็ม: `~/.claude/plans/immutable-sparking-boole.md`. **Phase 1 (push บิล) + Phase 2 (webhook รับสลิป + verify) + Phase 3 (review queue ให้เจ้าของยืนยัน manual) — ✅ DONE code+gate (2026-06-19).** ยังต้องตั้ง LINE bot + slip-verify provider เพื่อ live-test ลูป push/verify จริง (Phase 3 review live-smoke แล้ว).

- **DB** (migration `20260619000100_club_billing`, **applied prod**): `club_players` +`bill_amount numeric` (snapshot ยอดตอน push) +`paid_method text` (CHECK `promptpay_slip`|`manual`) +`bill_pushed_at timestamptz`. ตารางใหม่ `club_payment_slips` (id, club_id/club_player_id FK cascade, image_path, amount_detected, sender_name, receiver_name, trans_ref, verify_status `pending|verified|failed|manual`, verify_raw jsonb, created_at) + `club_audit_logs` (club ไม่เคยมี audit) — **ทั้งคู่ RLS on (service-role เท่านั้น)**. private bucket `payment-slips` (public=false, สลิป=PII).
- **LINE infra** `src/lib/notification/line-club.ts`: `pushTextToUser` / `pushFlexToUser` / `replyMessage` / `getMessageContent(messageId)` (api-data.line.me content API) / `verifyLineSignature(rawBody, sig)` (HMAC-SHA256 base64 + timingSafeEqual — สำหรับ webhook Phase 2). reuse token pattern จาก `line.ts`.
- **Slip-verify** `src/lib/club/slip-verify.ts`: `verifySlip(input, config)` adapter **provider-agnostic** (**config-driven รายก๊วน** — provider/apiKey/branchId ส่งจาก caller, **ไม่อ่าน env แล้ว**; provider/key ว่าง = `not_configured` → matchSlipToBill ส่ง manual). **implement จริงแล้วทั้ง 2** (image upload → normalize เป็น `SlipVerifyResult`): **EasySlip** `POST developer.easyslip.com/api/v1/verify` Bearer + multipart `file`, อ่าน `data.amount.amount`/`data.receiver.account.name.{th,en}`/`data.transRef`; **SlipOK** `POST api.slipok.com/api/line/apikey/<branchId>` header `x-authorization` + multipart `files` (branchId ส่งผ่าน config), อ่าน `data.amount`/`data.receiver.{displayName,proxy,account}`/`data.transRef`. + pure `matchSlipToBill({detected, billAmount, clubPromptpayId, clubPromptpayName})` → `verified`|`manual` (Hybrid: amount + receiver lenient last-4/name; ไม่ชัวร์→manual). +unit tests.
- **Action** `src/lib/actions/club-billing.ts`: `pushClubBillsAction({clubId, slipUrlByPlayerId})` — วน payable+unpaid ที่มี `line_user_id` (ผ่าน `profile_id→profiles.line_user_id`): snapshot `bill_amount`, **หยิบ slip URL จาก `slipUrlByPlayerId[playerId]`** (client render `SlipCard` variant `full` → `uploadBillSlipAction` kind `player`, path `${clubId}/bill-${playerId}.png`; ไม่ gen QR / Flex bubble ฝั่ง server แล้ว — `buildBillBubble` ลบทิ้ง) → **`pushImageToUser` (image message ล้วน ไม่มี text แยก)** → stamp `bill_pushed_at`; player ที่ reachable แต่ไม่มี slip URL → ข้าม (`skippedNoSlip`); audit `bills_pushed`. คืน `{pushed, failed, skippedNoLine, skippedNoSlip}`. guest (ไม่มี LINE) → ใช้ปุ่ม "ส่งสลิป" / "ดาวน์โหลดสลิปทั้งหมด" ใน `ClubPaymentCollector`. (v0.32.0: render ฝั่ง client แล้ว upload ทีละรูป → server relay; ปุ่มโชว์ progress "สร้างสลิป X/N")
- **Upload helper** `src/lib/actions/club-payments.ts`: `uploadBillSlipAction({clubId, kind:'amount'|'player', key, dataUrl})` — mirror `uploadClubPromptPayQrAction` (session + `assertCanManageClub` + `QR_DATA_URL_RE`/`MAX_QR_BYTES` + `isSafeStorageKey` กัน path escape) → upsert `club-qr` path เดิม (`group-bill-{amount}.png` / `bill-{playerId}.png`) → คืน `{ok,url}`. รองรับ client-render slip (v0.32.0).
- **UI**: `club-payment-collector.tsx` +ปุ่ม "เรียกเก็บผ่าน LINE" (Tooltip, toast ผล) + badge ต่อคน "ส่งบิลแล้ว"/"ไม่มี LINE". `page.tsx` derive `lineReachableIds` (club_players.id ที่ profile มี line_user_id — **ไม่ ship line_user_id ไป client**). i18n `club.payment.{pushLineBtn,pushLineTip,pushResult,pushing,billPushed,noLine}` (th/en).
- **⚠️ Prereq ก่อนใช้จริง:** LINE Login + Messaging channel ต้อง provider เดียวกัน (`line_user_id` ตรงกัน) · ผู้เล่นต้องแอดเพื่อนบอท · เปิด webhook + env `LINE_MESSAGING_CHANNEL_SECRET` · สมัคร slip-verify + `SLIP_VERIFY_*`.
- **Webhook (Phase 2)** `src/app/api/line/webhook/route.ts`: `POST` อ่าน raw body → `verifyLineSignature` (HMAC) **ก่อน** parse (401/400) → `after()` ตอบ 200 ทันที (LINE ต้อง ack เร็ว) → per-event try/catch: image event → profile (line_user_id) → candidate bills (unpaid + bill_pushed_at, หลายก๊วน, desc) → `getMessageContent` → resolve โหมด verify ของก๊วน candidate[0] (`billing_verify_settings`): **manual** → ข้าม verify (`reason=manual_mode`) / **byok** → อ่าน key จาก `club_billing_secrets` แยก → `verifySlip(buf, config)` → เลือก bill ตามยอด same-club (±0.01 ไม่งั้น most-recent) → upload `payment-slips` (private) → `matchSlipToBill` → insert `club_payment_slips` → **verified**: `paid_at`+`paid_method='promptpay_slip'` (race guard `.is("paid_at",null)`) + `pushTextToUser` ✅ / **manual**: push "รอเจ้าของตรวจ" → audit. `GET` = health 200. **auth = HMAC เท่านั้น** (ไม่มี session — webhook).
- **Review queue (Phase 3)** `src/components/club/club-slip-review.tsx` + `confirmSlipAction`/`rejectSlipAction` (`club-billing.ts`): สลิป `verify_status='manual'` โผล่ใน cost tab (thumbnail signed URL จาก private bucket + เทียบยอด detected/bill) → **ยืนยัน** = `paid_at`+`paid_method='manual'` + slip→`verified` / **ปฏิเสธ** = slip→`failed` (ยังค้าง) → audit. `page.tsx` query manual slips + `createSignedUrls` (manager เท่านั้น). i18n `club.payment.review*` (10 keys th/en).
- gates Phase 1+2+3: tsc 0 · vitest 671 · next build OK · i18n parity 55/55 · webhook local smoke (GET 200 · POST sig ผิด → 401) · **Phase 3 live-smoke PASS** (Playwright owner-cookie net-zero — seed สลิป manual → กดยืนยัน → `paid_at`+method=manual + slip verified + audit · console 0 err). **ยังไม่ live-test ลูป push/verify จริง** (รอ LINE bot + `LINE_MESSAGING_CHANNEL_SECRET` + slip-verify provider).
- **Per-club verify config (2026-06-19, branch `feat/club-slip-verify-mode` — ยังไม่ commit/merge/apply prod):** ยกเลิก env กลาง (`SLIP_VERIFY_*` deprecated, comment ใน `.env.example`), ตั้งค่ายืนยันสลิป**รายก๊วน** 2 โหมด — `manual` (default ทุกก๊วน → เข้าคิว review) / `byok` (ก๊วนใส่ provider+key เอง → auto-verify). migration `20260619000200_club_billing_verify_config`: `clubs.billing_verify_settings jsonb` (default `{"mode":"manual"}`, parse ผ่าน `parseBillingVerifySettings` ใน `src/lib/club/billing-verify-settings.ts` — fields `mode/provider/branch_id/key_set`) + ตารางแยก `club_billing_secrets` (club_id PK, api_key, RLS lockdown REVOKE anon/authenticated — service-role เท่านั้น, **api_key ไม่เคย join มากับ `clubs.*`**). action `updateClubBillingVerifySettingsAction(clubId, input)` (`club-payments.ts`, `assertCanManageClub`): byok upsert key เฉพาะตอนกรอกใหม่ (omit = คง key เดิม) / manual ลบ secret row; **audit ไม่ log api_key, ไม่คืน key ไป client**. webhook resolve mode รายก๊วน (manual ข้าม verify / byok อ่าน secret แยก). UI `club-slip-verify-config.tsx` (mode selector + byok form, key masked ผ่าน `key_set` flag ไม่ดึง key จริง) mount ใน cost tab ใต้ `PromptPayConfig`. `public-view.toPublicClub` redact `billing_verify_settings`. gates: tsc 0 · vitest 694 · next build OK · i18n parity (17 `club.payment.*` + 5 `actions.club.billingVerify*` th/en).

### Rotation Queue + Locked Pairs + Manual Match — ✅ DONE

- **DB**: `clubs.queue_settings jsonb` (parse via `src/lib/club/queue-settings.ts` `parseQueueSettings`, 12 fields: court_count, players_per_team 1|2, rotation_mode `fair_queue`|`winner_stays`|`fair_winner_fallback` (ดู #3 ใน create-form list), queue_mode `rest_longest`|`level_match` (legacy `smart`→`level_match`, `fifo`→`rest_longest` on parse; **fifo removed v0.25.0**), skill_level_enabled (**derived from queue_mode = level_match — no standalone UI toggle since v0.25.0**), game_time_limit_min, **not_ready_action** `skip`(default)|`requeue` [check-in-based, 2026-06-22], winner_stays_max, **max_skill_gap** 0-20 [0=ปิด, 2026-06-14], **balance_strictness** `balanced`|`strict` (legacy `loose`→`balanced` on parse), **balance_locked_pairs** bool, realtime_enabled). `club_matches` (id, club_id FK CASCADE, court, **side_a_player1/2 + side_b_player1/2** FK club_players CASCADE [**all 4 nullable since `20260617000100` → partial-roster: reserve a match/court with as few as 1 player; player2 null = singles**], status pending/in_progress/completed/cancelled, queue_position, winner_side a/b, score_a/b [legacy single-set; null บน row ใหม่], **games** jsonb default `'[]'` [per-set detail `[{a,b}]`, since `20260618000300`], **shuttles_used** int default 1, started_at, ended_at; partial unique `(club_id,court) WHERE in_progress`). `club_locked_pairs` (player1/2 FK, `games_remaining` null=ตลอด/N=นับถอย; RLS read-all). RPC `finish_club_match` (atomic complete + games_played++ / last_finished_at + ลด N-game locks + auto-release; **5-arg `+p_games jsonb` since `20260618000300`**, 4-arg เดิม = wrapper บางๆ zero-downtime) · RPC `delete_club_match` (completed → games_played−1 floor 0; in_progress no revert; last_finished_at + lock decrements ไม่คืน).
- **Pure** `src/lib/club/queue.ts` `buildNextMatch(pool, settings, stayingSide?, lockedPairs?)` — 4 queue_mode + winner_stays + skill-balanced split + locked-pair atomic side (strict wait) + singles ignore locks. **Skill-aware matchmaking (2026-06-14):** `pickBalancedMatch` routes `level_match` เมื่อ `skill_level_enabled` — กรอง candidate ตาม `max_skill_gap` (เทียบ anchor; **null-level eligible เสมอ**; `strict`→null ถ้าหาคนใกล้ไม่พอ, `balanced`→ผ่อนเพดาน; `max_skill_gap=0`≡พฤติกรรมเดิม). `splitSides` เพิ่ม intra-side-gap tiebreak เมื่อ sum 2 ฝั่งเท่ากัน. `balance_locked_pairs` เช็ก mean-gap คู่ล็อก vs ฝ่ายตรงข้าม. +10 vitest (gap/strictness/null/tiebreak). **Winner-stays อยู่ต่อทุกสนาม (fix 2026-06-21):** pure helpers ใหม่ `resolveCourtStay(courtMatchesNewestFirst, winnerStaysMax, eligibleIds)` (ตัดสินผู้ชนะของ 1 สนามที่จะอยู่ต่อ — streak/cap/eligible) + `planWinnerStays(allCompleted, {currentCourt, courtsWithActiveMatch, winnerStaysMax, eligibleIds})` (คืน `{stayingSide, reservedIds}` — `reservedIds` = ผู้ชนะของสนามอื่นที่ยังว่าง, สงวนไว้กันโดน build สนามนี้ดึงไปเป็นคู่ต่อสู้). +12 vitest. `CompletedMatchRow` type. ดู Bug fix ที่ `buildNextClubMatchAction` ด้านล่าง.
- **Actions** (owner/co-admin): `updateClubQueueSettingsAction` · `buildNextClubMatchAction` (pool + check-in gate + winner_stays streak + locks) · `startClubMatchAction` (court 23505 guard + **`isClubMatchFull` roster gate — a partial match can't start, `matchNotFullToStart`**) · `finishClubMatchAction` (RPC) · `cancelClubMatchAction` (soft `status='cancelled'`) · **`revertClubMatchToPendingAction(matchId)` (v0.28.0, 2026-07-12 — "กลับไปรอแข่ง": in_progress→pending, inverse ของ `startClubMatchAction`; update `{status:'pending', started_at:null, court:null, shuttles_used:0}` `.eq("status","in_progress").select("id").maybeSingle()` → 0 แถว = `matchNotInProgress` (concurrency guard); **คง `queue_position` เดิม → คืนตำแหน่งเดิมในคิว**; occupancy index เป็น in_progress-only จึงคืน pending ปล่อยสนามทันที; start ไม่แตะ games_played/winner-pointer จึงไม่ต้อง undo)** · `deleteClubMatchAction` (RPC, in_progress/completed) · `reorderClubQueueAction` (drag → queue_position 1..N pending) · `setClubMatchShuttlesAction` · `setClubMatchCourtAction({matchId, court})` (owner/co-admin; moves a **pending or in_progress** match to another club court — validates court ∈ `clubs.courts`, status-gated `.in(["pending","in_progress"])`, 23505 occupancy → "สนามนี้มีแมตช์กำลังเล่นอยู่") · `createClubManualMatchAction` (**partial roster: ≥1 player overall, ≤`players_per_team`/side; empty slots → null**) · **`setClubMatchPlayersAction({matchId, sideA[], sideB[], court?})`** (**edit a PENDING match's players AND optionally its court in one atomic row UPDATE — fill/swap/clear players + set/clear court (`court` omitted=leave as-is, name=set [validated ∈ `clubs.courts`], ""/null=courtless); status=pending only via `.eq("status","pending")` no-op → `matchCannotEditPlayers`**) · `createClubLockedPairAction` / `releaseClubLockedPairAction`. **Build fallback + detailed error (2026-06-17):** `buildNextClubMatchAction` เมื่อ `buildNextMatch` คืน null → (1) `available>=needed` แต่จัดไม่ได้ (skill-gap strict / คู่ล็อกขาดคู่) → `cannotFormMatchSkillLock`; (2) **`1<=available<needed` → สร้าง partial match** ด้วยผู้เล่นเท่าที่มี (เรียงคิว, เติม sideA ก่อน sideB; `buildPartialMatch` ใน `queue.ts`) — จองสนามไว้ เติมคนที่เหลือ inline แล้วเริ่มเมื่อครบ; (3) `available=0` → `notEnoughPlayersDetail {needed,available,checkedIn,playing}`. Pure helpers `isClubMatchFull(match, ppt)` + `buildPartialMatch(pool, settings, stayingSide?)` ใน `queue.ts` (11 vitest). **Winner-stays multi-court fix (2026-06-21):** `buildNextClubMatchAction` เดิม query ผู้ชนะที่อยู่ต่อแค่ `.eq("court", courtName)` แต่ pool คู่ต่อสู้ดึงจากผู้เล่นว่าง**ทุกคน** รวมผู้ชนะของสนามอื่นที่เพิ่งจบ → build สนามแรกอาจดึงผู้ชนะสนามอื่นมาเป็นคู่ต่อสู้ → สนามนั้นเสียสิทธิ์อยู่ต่อ (อาการ: ผู้ชนะอยู่ต่อแค่สนามที่สร้างคิวก่อน). **แก้:** query completed matches ทุกสนาม (limit 100) + เพิ่ม `court` ใน activeMatches select → `planWinnerStays` คืน `reservedIds` = ผู้ชนะของสนามอื่นที่ยัง**ไม่มีแมตช์ active** (สนามที่มี pending/in_progress แล้วไม่ reserve เพราะจะไม่ build winner_stays ตอนนี้) → ตัด `reservedIds` ออกจาก pool ก่อนเลือกคู่ต่อสู้. ผู้ชนะแต่ละสนามถูกสงวนให้อยู่ต่อสนามตัวเอง.
  - **Queue order (no DB unique on `queue_position`)**: `buildNextClubMatchAction` + `createClubManualMatchAction` insert at `max(queue_position)+1` non-atomically, so concurrent inserts can collide on the same position. Made harmless (not impossible) via a **`created_at` tiebreak**: every pending read orders by `(queue_position ASC, created_at ASC)` — server fetch `clubs/[id]/page.tsx` `.order("queue_position").order("created_at")`; client `club-queue-panel.tsx` shared `byQueueThenCreated` comparator at both pending-sort sites. `reorderClubQueueAction` renumbers 1..N on any manual drag, cleaning collisions. Chosen over an advisory-lock RPC to avoid a prod migration (user-confirmed 2026-06-09).
- **UI**: `club-tabs.tsx` (4 แท็บ URL-synced: ลงชื่อ/เช็คอิน · ล็อคคู่+คิว · ค่าใช้จ่าย · ตั้งค่า [manager-only]) · `club-queue-settings.tsx` (**explicit Save/ยกเลิก footer** โผล่เมื่อ dirty [draft+baseline, `queueSettingsEqual`; ตัด auto-save/debounce เดิมออก — v0.24.0 2026-07-10] + page-wide unsaved-guard `src/lib/hooks/use-unsaved-guard.ts` [module Set] → `ClubTabs.handleChange` block tab-switch (confirm `unsavedWarning`) + `beforeunload` เมื่อ dirty [ครอบ tab-switch + close/refresh; **soft-nav ออกหน้าอื่นไม่ครอบ** — App Router ไม่มี hook, accepted limitation]; **court manager คง auto-save** เพราะ rename ย้ายแมตช์จริง; **skill-balance sub-section** + **Levels card** เปิดเมื่อ `skill_level_enabled` (ผูกกับ queue_mode=level_match — Select ตั้งให้อัตโนมัติ, ไม่มี toggle แยกแล้ว v0.25.0; `parseQueueSettings` derive ค่าให้เมื่อ config ไม่มี flag เช่น preset apply, แต่คง explicit legacy value ไว้) — max_skill_gap / balance_strictness / balance_locked_pairs; **queue_mode ตัด `fifo` ออก** เหลือ rest_longest/level_match) · `club-queue-panel.tsx` (Tabs รอ/กำลัง/จบ; pending **drag-reorder** @dnd-kit [manager]; per-court build + start/cancel/finish-winner + elapsed ticker + **`CourtSelect`** [manager: pending/in_progress court badge → `<Select>` of `clubs.courts` → `setClubMatchCourtAction`; static badge when read-only or ≤1 court; CompletedRow stays static] + `ShuttleCounter` **symmetric outline stepper `[−ลูก] [+ลูก]`** (icons + "ลูก", minus disabled at 0; redesigned 2026-06-09 from faint ghost glyphs) + `DeleteMatchButton` [confirm dialog, in_progress/completed] + **`MatchFormDialog`** [unified **create + edit** dialog — trigger = "เพิ่มแมตช์เอง" (panel) หรือ ✎ icon ต่อแถว pending; fields = court **toggle-grid (แตะสนามที่เลือกซ้ำ = ยกเลิกเป็น courtless; create auto-picks `firstFreeCourt`)** + ผู้เล่น 4 ช่อง + prior-meetings warning; edit-mode **reseed-on-open** (derived reset, no stale) + **ล็อกฝั่ง "ผู้ชนะจากคิวที่ N"** placeholder (แสดง label, ตัดออกจาก submit; ✎ ซ่อนเมื่อทั้งสองฝั่งเป็น placeholder); submit → `createClubManualMatchAction` (create) / `setClubMatchPlayersAction({…,court})` (edit, players+court atomic)] — **pending-row lineup อ่านอย่างเดียว** (ชื่อ `A/B vs C/D`; แก้ทั้งสนาม+ผู้เล่นผ่าน ✎ dialog แทน inline เดิม) แต่ **row ยังคง `CourtSelect` inline** ให้เลือกสนาม+กดเริ่มได้เร็วโดยไม่ต้องเปิด dialog + **"เริ่ม" disabled + tooltip "ต้องเลือกผู้เล่นให้ครบก่อนเริ่ม" เมื่อ `!isClubMatchFull`**) · `club-locked-pairs.tsx` (gated `players_per_team===2`) · `edit-club-form.tsx` (always-open). migrations `20260606000300` · `20260607000100/000200/000300/000400/000500` · `20260617000100` (partial roster — drop NOT NULL on side_*_player1).
- **Reserve/waitlist (สำรอง)** ✅ DONE (2026-06-08, develop, live-verified): `club_players.status 'active'|'reserve'` (migration `20260608000200`, default active, +index). Adding beyond `max_players` → inserted as **reserve** (cap counts `status='active'` only; add never blocks). Remove an active player (kick/leave) → RPC `remove_club_player_and_promote(p_player_id, p_club_id)` deletes + auto-promotes the earliest reserve (ORDER BY position, joined_at) atomically (FOR UPDATE; club-scope guard). `buildNextClubMatchAction` pool filters `status='active'` (reserves never drafted into a match). UI `sortable-player-list.tsx` splits active (drag-reorder, **active ids only** to `reorderPlayersAction`) + "สำรอง (N)" section (#rank); `join-form`/`add-guest` stay enabled when full ("เต็มแล้ว — เพิ่มเป็นสำรอง"); `clubs/[id]/page.tsx` capacity badge = active count + "+N สำรอง". Live-smoke: throwaway club, 2 active+1 reserve → remove active → reserve auto-promoted → UI synced; real data untouched.
  - **Drag reserve → active (manual promote)** ✅ DONE (2026-06-09, develop): reserves now draggable; one `DndContext` spans both lists. Drop a reserve onto the active list (any active row, or an `ActiveDropZone` droppable that's enabled **only when active is empty** so it can't out-compete rows in `closestCenter` and silently no-op a reorder) → `promoteClubReserveAction({clubId, playerId})` (status flip `reserve→active`, **admin override — ignores cap**; keeps position → lands at active tail). Optimistic `setItems` flip; revert via `router.refresh()` on error. While a reserve is mid-drag the active zone shows a dashed "วางที่นี่เพื่อเลื่อนเป็นตัวจริง" cue. tsc 0 · vitest 76 club.
  - **Auto-promote on max_players raise** ✅ DONE (2026-06-09, develop): `updateClubAction` calls `promoteReservesToFill(sb, id, max_players)` after the write — promotes earliest reserves (position asc, joined_at asc) until `active === max_players`; no-op at/over cap or no reserves (effectively fires only on a cap raise). No migration (status flips only).
- **Score entry — หลายเซ็ต + เลือกผู้ชนะเอง** ✅ DONE (2026-06-18, supersedes "3 โหมด" 2026-06-08): finish panel ของ `InProgressRow` (`club-queue-panel.tsx`) กรอกคะแนน **ได้หลายเซ็ต** — เพิ่ม/ลบแถวเซ็ต (`Plus`/`X`, cap 9 เซ็ต, เริ่ม 1 แถวว่าง) แล้ว **ผู้จัดกดเลือกผู้ชนะเอง** ผ่านปุ่ม "ฝั่ง A/B ชนะ" (ผู้ชนะ **ไม่** derive จากคะแนน) หรือ "ไม่ระบุผล"; ทั้ง 3 ปุ่ม commit เซ็ตที่กรอกไปด้วย (แถวว่างทั้งหมด = winner-only เหมือนเดิม). เซ็ตเก็บใน `club_matches.games jsonb` (shape `[{a,b}]` mirror tournament `Game[]`); `score_a/score_b` เลิกใช้บน row ใหม่ (null) — display อ่านจาก `games` ก่อน, fallback `score_a:score_b` สำหรับ row เก่า. `CompletedRow` แสดงทุกเซ็ต `21-15 18-21 …` + **เวลาที่ใช้เล่น** (`started_at`→`ended_at`, ไอคอนนาฬิกา + tooltip, helper `formatDuration` → mm:ss / h:mm:ss); prior-meeting hint ใช้ helper `clubScoreParts` (1 เซ็ต→แต้ม, หลายเซ็ต→จำนวนเซ็ตที่ชนะ, row เก่า→`score_a/b`). action `finishClubMatchAction({matchId, winnerSide?, games?})` (เลิก `scoreA/scoreB`); RPC `finish_club_match` รับ `p_games jsonb` เพิ่ม (5-arg overload; 4-arg เดิมเก็บไว้เป็น wrapper บางๆ เพื่อ zero-downtime deploy). migration `20260618000300_club_match_games`. **Gate:** tsc 0 · vitest 654/654 · build OK · i18n parity th/en. ⚠️ ยังไม่ commit · ยังไม่ live-smoke.
- **Named courts (สนามมีชื่อ)** ✅ CODE DONE (2026-06-08, develop) — mirror tournament `courts`. แทน `queue_settings.court_count` (int) ด้วย `clubs.courts text[]` (named) + `club_matches.court` int→text. `Club.courts: string[]` · `ClubMatch.court: string`. Action `updateClubCourtsAction(clubId, courts[])` (trim/slice(40)/dedupe/cap 50, owner+co-admin). `buildNextClubMatchAction`/`createClubManualMatchAction` รับ `court: string`. UI: `club-court-manager.tsx` (DnD list + 250ms debounce serialize, clone ของ tournament `court-manager.tsx`) ในแท็บตั้งค่า; `club-queue-settings.tsx` เอา "จำนวนสนาม" input ออก; `club-queue-panel.tsx` build buttons + ManualMatchDialog court → `<Select>` จาก named courts. Page: `clubCourts = club.courts.length ? club.courts : ['1'..'court_count']` (fallback ก่อน migration apply / club ที่ไม่เคยตั้ง). **Migration แยก 2 ไฟล์ — APPLIED to prod 2026-06-09** (window: 0 live in_progress matches): `20260608000300_club_courts_column` (ADD `clubs.courts` + backfill ['1'..'N'] — NON-breaking) · `20260608000400_club_matches_court_text` (court int→text). Post-apply verify: `clubs.courts`=text[] (2/2 clubs backfilled), `club_matches.court`=text (28 matches intact, values '1'..'6'), occupancy index recreated. Add-court live-smoke (throwaway): UI + `updateClubCourtsAction` persisted `['1','2','สนาม A']`; net-zero. tsc 0 · vitest 59 club · build OK · owner live-smoke (throwaway club): court manager + court Select + build buttons "สนาม 1/2/3" render, console 0 errors/0 hydration; net-zero.
  - **Rename court (✅ 2026-06-11, merged master):** `renameClubCourtAction(clubId, oldName, newName)` (`clubs.ts`, owner/co-admin; trim/slice shared module const `COURT_NAME_MAX=40`; rejects empty/dup/oldName-missing/no-op, fails closed) renames `clubs.courts` **in place** (position preserved) **+ cascades `club_matches.court` oldName→newName** so existing matches keep pointing at the same physical court (no orphan); returns `movedMatches`. `club-court-manager.tsx`: each court name is an inline `<Input>` (Enter/blur = commit, Esc = cancel, optimistic + rollback; `dragging` state disables inputs during drag); shared `runSave(action, successMsg)` helper owns the serialize-behind-`inFlightRef` + rollback choreography for both array-save and rename; rename clears the pending debounce timer so a stale array-save can't revert it. No migration. ship-check PASS (1 P1 debounce-race + 2 P2 fixed · /simplify · net-zero live-smoke: '1'→'สนาม A' → `clubs.courts`=['สนาม A','2'] + match cascaded).
- **Dashboard tab (แดชบอร์ด)** ✅ DONE (2026-06-08, develop) — default landing tab on the club page (first tab; all viewers, read-only). `club-dashboard.tsx` ("use client", recharts via `ui/chart`): 5 stat cards (ผู้เล่น active/สำรอง · แมตช์จบ/กำลัง/รอ · ลูกขนไก่รวม · ค่าใช้จ่ายรวม · เฉลี่ย/คน) + 2 charts (เกมต่อผู้เล่น horizontal bar top 10 · การใช้สนาม bar) + ผู้เล่นทั้งหมด table (#/ชื่อ/ระดับ/เกม/สถานะ, sort เกม desc). Pure `src/lib/club/dashboard.ts` `computeClubDashboard(players, matches)` — COMPLETED matches only for games/court/shuttles, skips null player2 (singles), empty-club safe (6 vitest). **Cost reconciliation:** the "ค่าใช้จ่ายรวม" card uses `src/lib/club/cost-summary.ts` `computeClubCostSummary` (= `buildClubSplitInput` + `computeClubSplit` + `computeExpenseShares` − discounts), the SAME path `club-cost-breakdown.tsx` now consumes — so the dashboard card and the cost tab footer can't drift (5 vitest). `club-tabs.tsx` gains `dashboard` tab (defaultTab flipped checkin→dashboard). tsc 0 · vitest 70 club · build OK · live-smoke (throwaway populated + empty clubs): all sections render, cost card 220฿ = cost tab footer 220฿, empty-state on the empty club, console 0 errors/0 hydration; net-zero.
- **Cost/usage columns + CSV export + delete-club + manager-only** ✅ DONE (2026-06-09, develop). tsc 0 · vitest **95** club (+12: cost-usage 8 + cost-csv 4).
  - **Per-player usage helpers** (`cost-summary.ts`): `computePlayerUsage({club,players,matches})` → `Map<id,{hours,shuttles}>` (hours = `clampedSessionMinutes` in `cost-split.ts`, cross-midnight aware, ÷60; shuttles = Σ `shuttles_used` over in_progress+completed matches the player joined, FULL match count per participant = a usage count not a share) + `formatHours(h)` (3.0→"3", 2.5→"2.5"). Same filter as the cost split → usage columns reconcile with cost columns.
  - **Cost table (`club-cost-breakdown.tsx`)**: +columns **ชม.** + **ลูกที่ใช้** (after ผู้เล่น; footer activity cells blank) + **Export CSV** button → `generateClubCostCsv` (`src/lib/club/cost-csv.ts`, recomputes from the same shared helpers) via `downloadCsv` (BOM UTF-8 for Excel Thai). Filename `ค่าใช้จ่าย-<name>-<play_date>.csv`.
  - **Dashboard player table (`club-dashboard.tsx`)**: ผู้เล่นทั้งหมด table gains **เวลา (start–end) · ชม. · ลูกที่ใช้ · ค่าสนาม · ค่าลูก · รวม** (cost cols via `computeClubCostSummary` rows + `playerSessionTotal`, reconciles with cost tab). `ClubDashboard` now takes `club` + `expenses` props (page passes them).
  - **Delete club (owner-only)**: `deleteClubAction(clubId)` (`clubs.ts`) — owner_id check (NOT co-admin), `delete().eq("id")`, all 5 child tables ON DELETE CASCADE (club_players/matches/expenses/admins/locked_pairs — verified live), redirect `/clubs`. `delete-club-button.tsx` = type-the-club-name-to-confirm destructive Dialog in the settings "เขตอันตราย" section (owner-only render).
  - **Clubs are manager-only now**: removed the LINE self-join — deleted `join-form.tsx`, removed `joinClubAction` + `JoinSchema`/`JoinClubInput` from `clubs.ts`, removed the "ลงชื่อเล่น" page section (+ `myRow`). Renamed the add-player label **"เพิ่มผู้เล่น (guest)" → "เพิ่มผู้เล่น"** (`add-guest-player.tsx`). Players are added by owner/co-admin only.
- **Dashboard + cost review fixes** ✅ DONE (2026-06-09, develop) — `/code-review max` on #9+#10 surfaced 8 low-risk findings (none P0/P1); all fixed in one batch:
  1. **Court display single-prefix** — `club-court-manager.tsx` list row now renders `สนาม {name}` (matched queue/dashboard convention; stored names stay bare); placeholder `"ชื่อสนาม เช่น สนาม 1"` → `"เช่น 1 หรือ A"` so users don't type "สนาม" into the name.
  2. **One headline cost number** — `clubs/[id]/page.tsx` now derives `clubCostTotal = costSummary.grandTotal > 0 ? grandTotal : (total_cost ?? 0)` and feeds the SAME value to the page-header `รวมค่าใช้จ่าย` line AND the dashboard card `costTotal` prop (previously header used a separate expense-sum/total_cost figure → could disagree with the card).
  3. **เฉลี่ย/คน denominator** — divide by `d.totalPlayers` (all players the cost splits across), sub-label `หาร N คน` (was `activePlayers` / `ตัวจริง`, which overstated per-head since reserve players also carry shares).
  4. **Shuttle count = cost basis** — `dashboard.ts totalShuttles` now sums in_progress + completed (a live match already consumes shuttles), matching `buildClubSplitInput`'s shuttle filter; test asserts 7 (2+5).
  5. **Games chart keyed by player id** — `club-dashboard.tsx` datum `{id, games}`, `YAxis dataKey="id"` + `tickFormatter` resolving id→`truncate(name,12)`, so two players with the same / same-14-char-prefix name no longer collapse into one bar.
  6. **Expense rollup uses survivors** — `expense-manager.tsx` `PayerSubLine`/`PlayerRollup` filter `payer_player_ids` to still-existing players before dividing, aligning the per-head divisor with `computeExpenseShares`.
  7. **Shared per-player total** — `cost-summary.ts` exports `playerSessionTotal({court,shuttle,expense,discount}) = max(0, …)`; `computeClubCostSummary` + `club-cost-breakdown.tsx` both call it (single definition of the per-player figure).
  8. **ManualMatchDialog court resync** — `useEffect` snaps `court` back to `courts[0]` if its value leaves the (possibly-refreshed) `courts` list, so a stale removed-court name can't be submitted. Plus `queue-settings.ts` `court_count` documented as a frozen legacy fallback (no UI writes it; page.tsx still reads it to backfill).
  - tsc 0 · vitest **435** (70 club) · build OK · live-smoke (NOMKONZ, read-only as guest): games-chart Y-axis shows player **names** (no UUID leak), court chart `สนาม 3/4/5/6` (single-prefix); header `4,680 บาท` = dashboard card `4,680 ฿` = cost-tab footer `รวมทั้งหมด 4,680 ฿` (3,000 court + 1,680 shuttle); `เฉลี่ย/คน 142 ฿ · หาร 33 คน`. Throwaway guest profile deleted; prod net-zero.
- **Queue 'A' backlog — all built**: auto-rotate-all-courts (A1, 2026-06-23 — `buildAllCourtsAction` + "ทุกสนาม" button), game_time_limit over-time indicator (A4, 2026-06-23), `not_ready_action` (A3, check-in based, 2026-06-22), Realtime (A5, broadcast-from-DB, 2026-06-15). No remaining A-items.

### Batch Queue "สุ่มคิว" (tournament-style pre-generation) — ✅ DONE 2026-07-07 (feat/club-batch-queue)

แทนที่ปุ่ม `+ ทุกสนาม` / `+ สนาม N` เดิมด้วยปุ่ม **"สุ่มคิว"** เดียว: สุ่มชุดแมตช์ทั้ง session ลง pending แบบ**ไม่ผูกสนาม** ให้ทุกคนได้เล่น ≥ N เกม (pro-rate ตามเวลาที่อยู่) → เลือกสนามทีหลังผ่าน CourtSelect → เริ่มได้เมื่อมีสนาม+คนครบ. Design ล็อกจาก grilling 2026-07-07 (แทน design "ซ้อนคิวผูกสนาม + court_queue_limit" จาก 2026-07-06 ที่ไม่ได้ implement).

- **DB** (ทั้ง 3 migration ✅ applied prod + verified 2026-07-07): `20260707000100` `club_matches.court` **DROP NOT NULL** (courtless pending; index `uniq_club_matches_inprogress_court` คงเดิม — start gate กัน NULL ไม่ให้ถึง in_progress) · `20260707000200` `winner_next_match_id uuid FK club_matches ON DELETE SET NULL` + `winner_next_match_slot CHECK ('a','b')` + index (forward pointer บนแถว feeder, mirror ทัวร์; **ห้าม** CHECK คู่ null — SET NULL จะชน) · `20260707000300` `finish_club_match` (5-arg, zero-downtime) เพิ่ม **winner promotion**: feeder จบพร้อมผู้ชนะ → copy player ids ฝั่งชนะเข้า slot เป้าหมาย เฉพาะเมื่อเป้าหมายยัง pending และฝั่งนั้นว่างทั้งคู่ (แก้มือชนะ promotion เสมอ); winner_side null = ไม่ promote. Live-tested net-zero (DO-block seed chain → finish → side เติมถูก → 0 row เหลือ) · `20260707000400` **promotion guards (ship-check 2026-07-07 — ✅ applied prod + net-zero smoke-verified)**: finish ไม่ promote empty-side (`v_w1 IS NOT NULL`) + reject null-winner บน feeder (RAISE, mirror action guard); delete ย้อน promotion (clear target slot ถ้ายัง pending + ถือ winner เดิมเป๊ะ `IS NOT DISTINCT FROM` → กัน roster-ghost ตอน "เลือกผู้ชนะผิด→ลบ→ทำใหม่"). CREATE OR REPLACE ทั้ง 2 RPC, ไม่แตะ happy path · `20260707000500` **`swap_club_match_sides(m1,slot1,m2,slot2)` (✅ applied prod + net-zero smoke-verified)**: สลับ 2 ฝั่งของแมตช์ pending แบบ atomic (row-lock เรียงตาม id กัน deadlock) + guard กัน double-book/not-pending/same-match/cross-club — ใช้โดย reroll fallback (จัดคิวใหม่ตอน roster เต็มคิว). service_role-only (REVOKE FROM PUBLIC **+ anon, authenticated** — สองตัวหลังมี default-privilege grant ต้อง revoke ตรง ๆ)
- **Pure generator** `src/lib/club/batch-queue.ts` (20 vitest): `generateBatchQueue({pool, settings, lockedPairs, remaining, laneCount})` → `BatchMatchPlan[]` (`BatchSide = players | winnerOf(sourceIndex)`). **Simulation trick**: clone pool แล้ว bump `games_played` + synthetic `last_finished_at` ต่อแมตช์ที่วาง → ทุก pick ถัดไปผ่าน `buildNextMatch`/`orderPool`/`takeSides` เดิมได้ rest-spacing/fifo/level/skill-gap/locked-pairs ครบโดยไม่เขียนกติกาใหม่. Fair mode = ช่องชื่อจริงล้วน วนจน remaining หมด (filler จากคนเกมน้อยสุด → ได้ N+1; ไม่มี partial; progress guard กัน fifo วนไม่จบ). Lane mode (winner_stays/fair_winner_fallback) = K เลนตามจำนวนสนาม; ใบ chain: sideA = winnerOf(ใบก่อนในเลน) + sideB = ผู้ท้าชิงตาม fairness; emit สลับเลน; ช่อง winnerOf ไม่นับ N. **Double-book guard (แก้ ship-check 2026-07-07):** ช่อง winnerOf ถูกเติมตอน runtime ด้วย "ผู้ชนะ 2 คน (ไม่รู้ล่วงหน้า)" ของใบต้นทาง → การ exclude ต้องดู **possible-occupants** ไม่ใช่แค่ fixed ids. ต่อรอบ concurrent สร้าง `concurrentBase` = union ของ `planOccupants(laneLast[l])` **ทุกเลน** (helper resolve winnerOf ทั้ง chain แบบ recursive DAG + memo) แล้วส่งเป็น exclude ให้ทั้ง opener+challenger ของทุกเลนในรอบนั้น. ปิดทั้ง **cross-lane** (คนที่อาจ promote เข้าเลนอื่นในรอบเดียวกัน) และ **transitive P-vs-P** (incumbent chain 2+ hop ก่อนถูก draft เป็น challenger ตัวเอง). เลนที่ไม่มีคน safe เหลือ = ไม่เปิด. **ผลลัพธ์ที่ถูกต้อง:** winner_stays batch วางแผน **1 fixed game/คน/batch** (ผู้ชนะอยู่ต่อผ่านช่อง winnerOf ที่ไม่นับ; ท้าชิงซ้ำในแผน static ไม่ปลอดภัยเพราะอาจชนตัว incumbent) — เล่นต่อ = จบแมตช์แล้วสุ่มใหม่. Pro-rate: `resolvePlayerWindow` (ประกาศ start/end → เช็คอิน → หน้าต่างก๊วน) + `proRatedTarget` (reuse `clampedSessionMinutes`) + `countFixedAppearances` (pending+in_progress+completed; cancelled ไม่นับ)
- **Settings**: `queue_settings.batch_min_matches` (1-20, default 3, jsonb — ไม่ต้อง migration) จำค่า N ล่าสุด server-side (ตั้งแต่ v0.23.0 dialog **ไม่** ใช้ค่านี้เป็น default แล้ว — ใช้ค่าที่คำนวณแนะนำแทน; คอลัมน์ยังเขียนอยู่)
- **Actions** (`club-matches.ts`): `loadClubQueueContext` (pool assembly ร่วม) · `generateClubQueueAction(clubId,{minMatches})` (zod; pool **ไม่ตัดคน busy** — remaining นับให้แล้ว; insert 2 เฟส: batch insert courtless + เฟส 2 wire pointer บน feeder — ไม่ atomic, fail กลางทาง degrade เป็นช่องแก้มือ) · `rebuildClubPendingMatchAction(matchId)` ("จัดคิวใหม่" — pending เท่านั้น, คน own คืน pool, ฝั่ง placeholder live ไม่แตะ + exclude คนของ feeder, คง court/position/pointer) · `startClubMatchAction` gate ใหม่: **ไม่มีสนาม → `matchNeedsCourtToStart`**; ช่องไม่ครบ+มี feeder live → `matchWaitingForWinner` · `createClubManualMatchAction` court เป็น **optional** (ว่าง = courtless). `buildNextClubMatchAction`/`buildAllCourtsAction` retired พร้อม UI
- **UI** (`club-queue-panel.tsx` + `generate-queue-dialog.tsx`): ปุ่ม "สุ่มคิว" เปิด dialog (TanStack Form: N input + ตารางพรีวิว คน/เป้า/มีแล้ว/ขาด client-side จาก pure helpers) · CourtSelect รองรับ court null (placeholder "เลือกสนาม" / badge "ยังไม่เลือกสนาม") · ฝั่ง placeholder แสดง badge "ผู้ชนะจากคิวที่ N" (feeder in_progress → "ผู้ชนะสนาม X") แทน InlinePlayerSlot ทั้งฝั่ง manager+public; feeder ตาย (cancelled/จบไม่มีผู้ชนะ) → กลับเป็นช่องแก้มือ · ปุ่มเริ่ม disable: ไม่มีสนาม → รอผู้ชนะ → คนไม่ครบ (tooltip ตามลำดับ) · ปุ่ม "จัดคิวใหม่" (RotateCcw) รายใบ pending — สุ่มผู้เล่นใบนั้นใหม่จาก free pool ก่อน; **ถ้าไม่มีคนว่าง (roster เต็มคิว) → สลับทั้งฝั่งกับอีกแมตช์ pending** ผ่าน `planRerollSwap` + RPC `swap_club_match_sides` (atomic, กัน double-book, เคารพ winner-chain + ไม่แตะ locked pair) → toast "สลับผู้เล่นกับอีกคิวแล้ว"; สลับไม่ได้จริง → error `rebuildNoSwap` ชี้ไป "รื้อ+สุ่มใหม่" (ship-check 2026-07-07 fix ปุ่มที่ดูเหมือน no-op) · **layout หน้าเดียวไม่มีแท็บ (2026-07-07)**: sub-tab รอ/กำลัง/จบ ถอดออก — 3 section ซ้อนกันแยกด้วยสี (กำลังแข่ง=warning จุด pulse อยู่บนสุดเพราะสั้น+สำคัญสุด, รอแข่ง=primary, จบแล้ว=success; header h3 + จุดสี + count Badge + Card `border-l-4` โทนเดียวกัน); section กำลังแข่ง/จบแล้ว ซ่อนเมื่อว่าง; i18n keys `tabPending/tabInProgress/tabCompleted` ใช้ต่อเป็น section label, `inProgressEmpty/completedEmpty` ลบ (orphaned)
- **i18n**: `club.queuePanel.*` ~20 keys ใหม่ th/en (generate dialog/preview/toasts/placeholder/court/tooltips/re-roll) — ลบ buildAll*/buildCourt*/toastBuilt* ที่ตายแล้ว; `actions.club.*` 7 keys (generate*/matchNeedsCourtToStart/matchWaitingForWinner/rebuild*)
- **v0.23.0 (2026-07-10) — เช็คอิน hard gate + แนะนำ N อัตโนมัติ:** `loadClubQueueContext` (สุ่มคิว + จัดคิวใหม่) กรอง pool เป็น **checked-in เท่านั้น** เสมอเมื่อมี ≥1 คนเช็คอิน — **ปลดจาก `not_ready_action`** (เดิมกรองเฉพาะเมื่อ `skip`) ให้ตรงกับ `queue-preview.ts` ที่กรอง hard อยู่แล้ว (แก้ drift ระหว่าง preview กับผลจริง); ไม่มีใครเช็คอิน → ทั้งโรสเตอร์ active (safety valve). helper `suggestBatchTarget(M, ppt)` (`batch-queue.ts`, +6 vitest) → `{meetPerMatch = 2·ppt−1, floor, ceil}` ของ `(M−1)/meetPerMatch` (M = จำนวนคนเช็คอิน, fallback = active ทั้งหมด; "เจอ" = ทุกคนในคอร์ต = คู่+คู่ตรงข้าม, doubles 3/singles 1), clamp 1..20. `generate-queue-dialog.tsx` default = **ceil เสมอ** (เลิกใช้ `batch_min_matches` ที่จำไว้) + hint ช่วง `floor–ceil` (`generateDialogSuggestHint`) + ปุ่มรีเซ็ตกลับ ceil (`generateDialogResetTooltip`, RotateCcw); เจ้าของยังพิมพ์แก้เองได้. prop `batchMinMatches` ถอดจาก dialog/panel/2 pages, ส่ง `playersPerTeam` แทน. CONTEXT.md เพิ่มศัพท์ Meet/Check-in gate/Suggested target. tsc 0 · vitest 790 · build OK
- **E2E** (`club-flow.spec.ts` rework): สุ่มคิว N=1 → 2 ใบ courtless → เริ่มถูก disable ("ต้องเลือกสนามก่อนเริ่ม") → เลือกสนามครบ → เริ่มได้ · จัดคิวใหม่คง court/position · winner chain: seed feeder→target → badge "ผู้ชนะจากคิวที่ N" → จบ feeder ผ่าน UI → promotion เติม target + badge หาย

#### Variety (คู่หลากหลาย) + รื้อ+สุ่มใหม่ — ✅ DONE 2026-07-07 (v0.20.0)

Design ล็อกจาก grilling 2026-07-07 — **priority ladder (strict)**: (1) ทุกคนได้ ≥ N เกม (hard) → (2) โหมดคิว/ลำดับ (rest/fifo) → (3) **variety** → (4) skill-gap (อ่อนสุด). partner-repeat กับ opponent-repeat ถ่วง **เท่ากัน**. ความจำ = **คืนนี้เท่านั้น** (club_matches ปัจจุบัน; cross-session = v2).

- **`src/lib/club/pair-history.ts`** (ใหม่, 8 vitest): `PairHistory {partner,opponent: Map<pairKey,count>}` + `pairKey` (order-independent) · `buildPairHistory(rows)` seed จาก pending+in_progress+completed · `recordPairing`/`recordSidePartner` (winner-chain: นับเฉพาะ partner ของ challenger — คู่ต่อสู้ = ผู้ชนะที่ยังไม่รู้) · `pairingCost` (= partner-repeat + opponent-repeat) · `partnerPairCost`. Type-only import ข้ามกับ `queue.ts` (ไม่มี cycle)
- **`generateBatchQueue`** รับ `history?` เพิ่ม (clone → update ทุกใบที่วาง). `planFullMatch` เปลี่ยนจาก "หยิบ fairest ตรง ๆ" เป็น **enumerate ในหน้าต่าง tier** แล้วเลือก cost ต่ำสุด: `queueTierKey(p,settings)` (**rest_longest/level_match = `games_played`** — คนเล่นครบเท่ากัน = tier เดียว, เสมอภาค, variety สลับข้ามได้; fifo = `position`) → คน tier ที่ดีกว่า cutoff ถูกบังคับลง (queue-mode > variety) → variety สลับได้เฉพาะใน tier ของ cutoff (VARIETY_WINDOW_SLACK=4, cap 64 combos). **rest-spacing แยกออกจาก tier**: `planFullMatch` ติดตาม `justPlayed` (ผู้เล่นแมตช์ก่อนหน้า) แล้วกันออกจาก `choosable` เพื่อไม่ให้เล่นติดกัน (fallback: ถ้า bench เหลือ < fillCount ใช้ทั้ง tier). Tiebreak: cost → **remSum สูงสุด (เสิร์ฟคนขาดเกมก่อน กัน packing บาน)** → id key (deterministic, ไม่มี Math.random). `splitSides(chosen,settings,history?)` เพิ่ม partner-repeat tiebreak (skill-on: ในกลุ่ม sum เท่ากัน repeat < gap; skill-off: partition repeat ต่ำสุด) — `history` undefined = พฤติกรรมเดิมเป๊ะ. `planChallengerSide` เลือกคู่ challenger ที่ partner-repeat ต่ำสุดในหน้าต่าง fairness. **สมมติฐาน**: strict `max_skill_gap` ยังเป็นเพดานแข็ง — variety เลือกในคนที่ผ่านเพดานเท่านั้น
  - **[แก้ 2026-07-07 — foursome-lock, bug.md Resolved]** เดิม tier คีย์ด้วย `last_finished_at` (timestamp จำลองเพิ่มทีละแมตช์) → แต่ละแมตช์เป็น tier ของตัวเอง → เมื่อจำนวนคนหารลงตัว (เช่น 12 คน/4 = 3 แมตช์) ผู้เล่นถูกล็อกเป็นก๊วนย่อย 4 คนถาวร, variety ทำอะไรไม่ได้ (พิสูจน์: distinctMatchups 3/30). แก้เป็น `games_played` + `justPlayed` แล้ว → 12 คน/N10 ได้ 29/30 แมตช์ไม่ซ้ำ, adjacent-share 0. regression test: "even division + high N does not freeze into fixed foursomes"
- **`regenerateClubQueueAction(clubId,{minMatches})`** ("รื้อ+สุ่มใหม่"): เคลียร์ winner pointer ที่ชี้เข้าแถว pending → ลบ pending ทั้งหมด → เรียก generate ใหม่ (top-up = สร้างใหม่หมดเพราะ remaining นับจาก in_progress/completed). ไม่แตะ in_progress/completed (ยัง seed history). `generateClubQueueAction` ส่ง `history` จาก `allMatches` ที่ดึงอยู่แล้ว
- **UI** (`generate-queue-dialog.tsx`): footer 2 โหมด — ปกติ = ปุ่ม "รื้อ+สุ่มใหม่" (RotateCcw, แสดงเมื่อ pending>0) ซ้าย + "สุ่มเพิ่มในคิว"/"ยกเลิก" ขวา; กด "รื้อ+สุ่มใหม่" → inline confirm ("ลบคิว N รายการ…") ก่อนยิง. i18n `regenerate*`/`toastRegenerated` th/en (114 keys parity)
- **ข้อจำกัด (ยอมรับ)**: โหมดผู้ชนะอยู่ต่อ — ช่อง winnerOf เติมตอน finish โดย RPC จึง**วางแผน opponent-variety ของผู้ชนะล่วงหน้าไม่ได้** (ทำได้แค่ challenger).
- **Foursome-lock fix (ship-check 2026-07-07)**: เดิม pool == 2×match-size (เช่น 8 คน doubles/สนามเดียว) rest-spacing บังคับ foursome ตรงข้ามทุกรอบ → 2 ก๊วนไม่เจอกันทั้งคืน (distinctFoursomes=2). แก้ `planFullMatch`: `if (eligible.length < fillCount)` → **`<=`** (ตรง intent comment เดิม; `<` พลาด boundary) → ที่ 2× ผ่อน rest-spacing ให้ variety เลือก grouping ข้ามก๊วน. Probe: 8 คน/N8 → distinctFoursomes **2→14**, partnership **12→28 ครบทุกคู่**, crossHalf **0→12**, maxRepeat 2, fairness ยังถึง N (trade: ยอม back-to-back 1 ครั้งที่ boundary). pool ≥ 3× ยังคง rest-spacing เข้ม.
- **Tests**: `pair-history.test.ts` (8) + `batch-queue.test.ts` (28 — variety block + **ship-check regressions 2026-07-07**: `assertNoConcurrentDoubleBooking` เขียนใหม่ให้ resolve winnerOf → possible-occupants disjoint (จับ cross-lane + P-vs-P; ของเดิมเช็คแค่ fixedIds จึง blind) · even-division 8 คน mix ไม่ lock · winner_stays 1 fixed game/คน). รวม **808/808**

#### Locked-pair time-mismatch warning — ✅ DONE 2026-07-14 (v0.35.0)

เป้า pro-rate ต่อคน (`computePlayerTarget` = N × เวลาที่อยู่ ÷ เวลา session) เป็น **floor (ขั้นต่ำ) ไม่ใช่ cap**. เมื่อ **locked pair** จับคนเป้าต่ำ (มาสาย/กลับก่อน) ล็อกกับคนเป้าสูง (อยู่เต็มเวลา) → คู่ล็อกต้องลงเล่นด้วยกันทุกแมตช์ → คนเป้าต่ำถูกดันให้เล่นเท่าคนเป้าสูง (เกินเป้าตัวเอง). เคสจริงที่เจอ (club `589c5747…`): BANK (`end_time=20:00`, เป้า 3) ล็อกกับ Jxler (เต็ม, เป้า 5) → หลัง "รื้อ+สุ่มใหม่" BANK ได้ 5 = Jxler เป๊ะ. นี่คือข้อจำกัดเชิงออกแบบของ locked pair (ทำงานถูกตาม intent) ไม่ใช่บั๊ก generator — จึงเลือกทาง **เตือน** แทนแก้อัลกอริทึม.

- **Helper** `playerPresenceMinutes(row, clubStart, clubEnd)` ใน `batch-queue.ts` (reuse `resolvePlayerWindow` + `clampedSessionMinutes` — window เดียวกับ `computePlayerTargets` เป๊ะ) · `findLockedPairMismatches(players, locks, clubStart, clubEnd)` ใน `queue-preview.ts` → คู่ล็อกที่ presence-minutes ต่างกัน พร้อมระบุคน "สั้นกว่า" (`LockedPairMismatch {shorterId/Name, shorterMinutes, longerName, longerMinutes}`). **N-independent** (คีย์ที่นาที ไม่ใช่การปัดเป้า)
- **UI** — `club-locked-pairs.tsx`: เตือนกล่อง amber ตอนเลือก 2 คนจะล็อก (`windowWarnCreate`) + ไอคอน `AlertTriangle` + tooltip ต่อแถวคู่ที่ล็อกไว้แล้ว (`windowWarnRow`); `generate-queue-dialog.tsx` (หน้า "สุ่มคิวทั้งชุด"): กล่อง amber ใต้ตารางพรีวิว ไล่รายคู่ (`lockMismatchTitle`/`lockMismatchItem`). ต้องส่ง `players` (พร้อม start/end/checked_in_at) + `clubStart/clubEnd` เข้า `ClubLockedPairs` และ `locks` เข้า `ClubQueuePanel`→`GenerateQueueDialog` (wired ทั้ง 2 page: `(app)/clubs/[id]` + `(public)/c/[id]`)
- **i18n**: `club.lockedPairs.windowWarnCreate/windowWarnRow` + `club.queuePanel.lockMismatchTitle/lockMismatchItem` (th/en, parity 942)
- **Tests**: `locked-pair-mismatch.test.ts` (10 — presence minutes: full/leave-early/late/clamp; mismatch: equal→none, BANK+Jxler shorter-pick regardless of column order, late via checked_in_at, missing-player skip, multi-lock). tsc 0
- **ไม่ทำ (ยังเปิดไว้)**: fix (ข) — generator filler ปัจจุบัน (`pickCandidates` `batch-queue.ts:462`) เลือกคน games น้อยสุดก่อน = ดันคนเป้าต่ำเกินเป้าแม้ไม่ล็อกคู่ (sort ตาม `games_played − target` ยังไม่ทำ)

#### N-game lock budget: respect quota at queue-time (derive) — ✅ DONE 2026-07-14 (v0.37.0)

เดิม lock "N เกม" ลด `games_remaining` **เฉพาะตอนแมตช์จบ** (finish RPC) และ generator โหลด lock เป็นแค่ `[p1,p2]` ทิ้ง count → มองทุก lock เป็น "ตลอด" → สุ่มคิวทีเดียวจับคู่ติดกันเกิน N. แก้เป็น **derive semantics** (grill 2026-07-14):

- **Schema semantic change (R1)**: `club_locked_pairs.games_remaining` = **QUOTA คงที่** (NULL=ตลอด) ไม่ mutate อีก. live remaining = `quota − countLockedTeammateMatches(matches)` (นับใบ pending+in_progress+completed ที่คู่นี้อยู่ทีมเดียวกัน) → **ยกเลิก/ลบ pending = refund อัตโนมัติ** ไม่มี counter ให้ drift. lock **ไม่ auto-remove** ที่ 0 — เจ้าของปลดเอง
- **Migration** `20260714000100_finish_club_match_drop_lock_decrement.sql` (⏳ ยังไม่ apply prod — apply ตอน deploy กัน desync): CREATE OR REPLACE `finish_club_match` **ตัดบล็อก `games_remaining -= 1` + `DELETE ... <= 0`** (ที่เหลือ = winner-promotion + guards เดิม byte-identical)
- **Pure helpers** (`batch-queue.ts`): `countLockedTeammateMatches(matches,a,b)` · `deriveLockBudgets(lockRows, matches)` → `{ active: LockedPair[] (remaining>0 only), budget: Map<pairKey,number> }` (NULL→Infinity)
- **Generator** `generateBatchQueue` รับ `lockBudget?: Map<pairKey,number>`; `activeLocks` เป็น mutable — `markScheduled` เผา budget เมื่อคู่ล็อกถูกวางลงแมตช์เดียวกัน, budget=0 → drop lock + rebuild `lockedPartner` (ที่เหลือของ batch จับกับคนอื่นได้). ไม่ส่ง budget = Infinity = พฤติกรรมเดิม (backward-compatible, 44 เดิมผ่านหมด)
- **Actions** (`club-matches.ts`): `loadClubQueueContext` fetch matches ครั้งเดียว (status+slots) แล้ว `deriveLockBudgets` → คืน `lockedPairs` (active) + `lockBudget` + `matches`; generate action reuse `ctx.matches` + ส่ง `lockBudget`. incremental reroll/manual ใช้ `ctx.lockedPairs` (active) อัตโนมัติ
- **UI** `club-locked-pairs.tsx`: badge โชว์ remaining ที่ derive (`quota − teammateCount`, clamp 0) + AlertTriangle เตือน `overQuota` เมื่อจัดเกินโควตา; 2 page ส่ง `matches` เข้ามา. i18n `club.lockedPairs.overQuota` (th/en)
- **Tests**: `locked-pair-budget.test.ts` (7 — countLockedTeammateMatches, deriveLockBudgets forever/refund/consumed/over-clamp, generator budget cap ≤N + ไม่ stall + no-budget>2). tsc 0 · vitest 869
- **ไม่ทำ**: fix (ข) generator filler favoring (`pickCandidates`) ยังเปิดไว้เหมือนเดิม (คนละเรื่องกับ lock budget)

#### Queue name search (ค้นหาชื่อในแท็บคิว) — ✅ DONE 2026-07-14 (v0.36.0)

ช่องค้นหาบนสุดของ `club-queue-panel.tsx` กรองทั้ง 3 section (รอแข่ง/กำลังแข่ง/จบแล้ว) ตามชื่อผู้เล่น.

- **Filter**: `matchHit(m)` = query ว่าง OR ชื่อจาก slot ใดใน `side_a_player1/2` `side_b_player1/2` (resolve ผ่าน `nameMap`) มี substring ตรง (lowercase). สร้าง `visibleInProgress/visiblePending/visibleCompleted` ที่ระดับ render (ไม่ memoize — ขนาดเล็ก). ช่อง winnerOf placeholder (slot null) ไม่แมตช์ตอนค้นหา
- **UI**: `Input type="search"` + ไอคอน `Search` + ปุ่มล้าง `X`; แต่ละ section ใช้ visible array (badge count + map); pending section ทั้ง `<section>` ซ่อนเมื่อค้นหาแล้วว่าง; ข้อความรวม `searchEmpty` เมื่อไม่พบทั้ง 3 ส่วน
- **Highlight**: helper `HighlightText({ text, query })` แยกทุก occurrence ของ `q` (case-insensitive, คงตัวพิมพ์เดิม) ครอบด้วย `<mark className="bg-warning/40">`; `query={q}` ส่งเข้า `PendingRow`/`InProgressRow`/`CompletedRow` (prop optional — `q` ว่าง = render ข้อความเดิม). ครอบชื่อใน label หลักทั้ง 3 row (ข้าม winnerOf placeholder + dialog ภายใน finish/revert). ใช้ `q` ตัวเดียวกับ `matchHit` → highlight ตรงกับ filter เสมอ
- **ระหว่างค้นหา (`searching`) พัก DnD + bulk-select**: `pendingSelectActive`/`completedSelectActive` = `selectMode && !searching`; pending card เพิ่ม branch `searching ?` render `PendingRow` แบบไม่ลาก + เลขคิวจริงจาก `pendingPos` (id→ตำแหน่งใน pendingOrder เต็ม); toggle/drag-hint/select-all/bulk-bar ซ่อนเมื่อ searching. per-row actions (เริ่ม/ยกเลิก/รีเซ็ต/เลือกสนาม) ยังทำงาน
- **i18n**: `club.queuePanel.searchPlaceholder/searchClear/searchEmpty` (th/en, parity 945)

### Reserve / Waitlist (สำรอง) — ✅ UI DONE (2026-06-08, develop)

- **DB**: `club_players.status "active"|"reserve"` (backend already done — migration + server actions not touched by this change).
- **Capacity logic**: `joinClubAction`/`addGuestPlayerAction` insert `status='reserve'` when `active >= max_players`; adding is always allowed (no 403). Auto-promotion server-side when an active player leaves.
- **Reserves excluded from queue**: `buildNextClubMatchAction` pool excludes `status='reserve'` rows.
- **UI changes (2026-06-08)**:
  - `src/app/(app)/clubs/[id]/page.tsx` — capacity now counts ONLY `status==='active'` (`activeCount`, `reserveCount`, `full = activeCount >= max_players`). Header badge: `"เต็ม"` (if full) **or** `{activeCount}/{max_players}` badge + `+{reserveCount} สำรอง` badge when reserves exist. Info card `คน` line uses `activeCount (+N สำรอง) / max`. `joined` (total) preserved for cost `playerCount` divisor.
  - `src/components/club/join-form.tsx` — removed "ก๊วนเต็มแล้ว" early-return; `!open` state shows info note `"เต็มแล้ว — เพิ่มเป็นสำรอง (รอคิว)"` when `full`; same note shown inside open form; success toast = `"เพิ่มเป็นสำรองแล้ว (รอคิว)"` when `full`, else `"ลงชื่อสำเร็จ"`.
  - `src/components/club/add-guest-player.tsx` — same changes: removed block, info note in collapsed + open states, success toast conditioned on `full`.
  - `src/components/club/sortable-player-list.tsx` — extracted shared `PlayerRowBody` (presentational, no `useSortable`). Active players (`status==='active'`) in `SortableContext` (drag-reorder). Reserve players in a second `SortableContext` below, header `สำรอง (N)` + `รอคิว` badge, rank `#1/#2/…`, same per-row actions (SessionEditor / CheckInButton / Leave / Kick). `handleDragEnd` reorders ONLY active array → `reorderPlayersAction(clubId, reorderedActive.map(p => p.id))` — reserve ids never passed to reorder. **Updated 2026-06-09**: reserves draggable; both `SortableContext`s share one `DndContext`; dragging a reserve onto the active list promotes it (`promoteClubReserveAction`) — see Reserve/waitlist bullet above for the `ActiveDropZone`-empty-only + optimistic-flip details. **Updated 2026-06-13**: bulk-select mode — header "เลือกหลายคน"/"เสร็จสิ้น" toggle (canManage only); select mode disables dnd drag handles; per-row `Checkbox` (active + reserve sections); select-all row with indeterminate state; sticky `BulkActionBar` (≥1 selected): เช็คอิน / ยกเลิกเช็คอิน / ตัวจริง / สำรอง / แก้เวลา+เกม (Dialog) / ลบ (confirm Dialog with name list + impact bullets); `BulkSessionDialog` has per-field enable-Checkbox so only ticked fields are sent; `BulkDeleteDialog` loops RPC per player to preserve auto-promote semantics; all actions toast count + `router.refresh()` + clearSelection; max-h-[90dvh] overflow guard on both dialogs.

### Skill Levels (levels table + FK) — ✅ CLUB IMPLEMENTED (2026-06-07) · ✅ PER-CLUB SETS + skill matchmaking (2026-06-14, develop)

ระดับฝีมือย้ายจาก free-text → ตาราง `levels` อ้างผ่าน FK. **2026-06-14: เปลี่ยนจาก global ล้วน → per-club override + global fallback** (`levels.club_id` NULL=global default [ทัวร์ฯ ใช้ + fallback], non-null=ชุดเฉพาะก๊วน) + เพิ่มจับคู่คิวตามระดับฝีมือ. tournament ยังอ่านชุด global เท่านั้น (ไม่กระทบ).
- **DB** migration `20260607000700`: ตาราง `levels` (id, `real` numeric unique [ค่าคำนวณ], `label` text unique [แสดง], `sort_order`, created_at; RLS read-all) seed 1=BG · 1.25=BG+ · 1.5=N- · 2=N · 2.5=S- · 3=S · 3.5=P- · 4=P. `club_players +level_id` FK → levels ON DELETE SET NULL (+index); legacy `level` text คงไว้เป็น fallback. migrate ค่าเดิม (BG+/N/N-) → level_id ตาม label.
- **Actions** (`src/lib/actions/levels.ts`): **2026-06-14 per-club** — `getGlobalLevelsAction()` (`.is(club_id,null)`, ทัวร์ฯ) · `getClubLevelsAction(clubId)` (club rows ถ้ามี ไม่งั้น fallback global) · `createLevelAction`/`updateLevelAction`/`deleteLevelAction({clubId,…})` gate `assertCanManageClub` (owner/co-admin เท่านั้น — เดิม non-guest ใดก็ได้) + เรียก RPC `clone_global_levels_to_club` ก่อนเขียน + scope `.eq(club_id,clubId)`. `addGuestPlayerAction` รับ `level_id`. `buildNextClubMatchAction` resolve queue level จาก `levels.real`. `Level +club_id` type.
- **Per-club architecture (2026-06-14)** — migrations `20260613000100` (ADD `levels.club_id` FK→clubs CASCADE + 4 partial unique index: global `(label)`/`(real)` WHERE club_id IS NULL, per-club `(club_id,label)`/`(club_id,real)` WHERE NOT NULL) · `20260613000200` (DROP global UNIQUE เดิม `levels_label_key`/`levels_real_key` — partial index แทน) · `20260613000300` RPC `clone_global_levels_to_club(p_club_id)` (SECURITY DEFINER + `search_path=public`, REVOKE จาก anon/authenticated; idempotent **copy-on-first-write**: ก๊วน customize ครั้งแรก → copy 8 global เป็น club rows + remap `club_players.level_id` ของก๊วนนั้นจาก global → club row ตาม label, atomic CTE). **APPLIED to prod 2026-06-14** (levels=8 rows, additive/backward-compat, advisor clean). `club-levels-manager.tsx` คืน club settings tab (รับ `clubId`+`isCustomized`; badge "ใช้ชุดเริ่มต้นร่วม"/"ชุดเฉพาะก๊วนนี้"). อ่าน: 2 club pages (`(app)/clubs/[id]` + `(public)/c/[id]`) → `getClubLevelsAction`; 4 tournament pages → `getGlobalLevelsAction`. tsc 0 · vitest 625 · build OK · live-smoke pending (`/ship-check` ก่อน merge).
- **Global-level site-admin editor (v0.39.0, 2026-07-15 — wayfinder #59/#61):** เพิ่ม write path ให้ชุด global (`levels` where `club_id IS NULL`) ที่เดิมอ่านได้อย่างเดียว. **Actions** (`levels.ts`): `createGlobalLevelAction`/`updateGlobalLevelAction`/`deleteGlobalLevelAction` — gate `isSiteAdmin()`, scope `.is("club_id", null)` (ห้ามแตะ club copy), reuse `levelSchema`, delete มี last-global-level guard (`cannotDeleteLastLevel`), revalidate `/admin`. **UI** `src/components/admin/admin-levels-manager.tsx` (mirror `ClubLevelsManager` แต่ไม่มี clubId) render ใน `/admin` (`getGlobalLevelsAction()` parallel กับ `getAppSettings()`). i18n namespace ใหม่ `admin.levels` (19 keys th/en). **ผลกระทบ:** แก้ global → ก๊วนใหม่ (clone) + ก๊วนที่ยังไม่ customize + fallback tournament; ก๊วนที่ customize (`club_id=<uuid>`) แล้วไม่กระทบ. ไม่มี migration (table มี global rows อยู่แล้ว). tsc 0 · vitest 878 (ไม่มีเทสใหม่ — action เป็น DB-guard ล้วน) · build OK. browser/DB smoke + PR รออนุมัติ.
- **Bot-message site-admin editor (v0.40.0, 2026-07-15 — wayfinder #59/#60):** ให้ site admin แก้ข้อความอัตโนมัติของบอท LINE ที่เดิม hardcode. **Engine** `src/lib/bot-messages.ts` — registry `BOT_MESSAGE_SPECS` (15 keys: `bindSuccess/bindInvalid/bindConflict` + `selfLink*` 7 + `notifyStatus/notifyBracket/notifyScore/notifyMatchCall` + `groupBillScanPrompt`) แต่ละ key มี `{required[], default}`; `renderBotMessage` (แทน `{name}`, strip `{unknown}`), `missingRequiredPlaceholders`, `parseBotMessages` (tolerant), `resolveBotMessage` (override-if-nonblank-else-default), `BOT_MESSAGE_SAMPLE_VARS` (สำหรับ preview). **Storage** `app_settings.messages jsonb` (migration `20260715000100`, apply ตอน deploy). **Read/write** `getAppSettings()` คืน `messages` (parse) + `updateBotMessagesAction` (gate `isSiteAdmin`, validate required-placeholder รายข้อความ, blank=clear override). **Wiring:** `notifyTournamentEvent(id, event, key, vars, settings?)` เปลี่ยน signature → gate ก่อนแล้ว fetch+resolve ในตัว (matches.ts 5 sites: score/bracket×2/matchCall×2, tournaments.ts status); webhook `route.ts` 10 replies (fetch overrides หลัง guard — ไม่ยิงทุก chatter); group-bill scan prompt = `buildGroupBillListMessages({scanPrompt})` + `pushGroupBillsAction` resolve + thread ผ่าน page.tsx→collector→dialog ให้ preview ตรงกับที่ส่งจริง. `notifyMatchCall` เพิ่ม optional `{court}` (pre-formatted " (สนาม X)"). **UI** `admin-bot-messages-manager.tsx` — field/ข้อความ + live preview + reset รายข้อความ + validate client-side, save รวม 1 ปุ่ม. i18n `admin.botMessages` (23 keys th/en) + `actions.admin.messagePlaceholderMissing`. tsc 0 · vitest 892/892 · build OK. browser smoke + PR รออนุมัติ.
- **UI**: `join-form`/`add-guest-player` level **Select** (sentinel `__none__` = ไม่ระบุ → level_id null) · `sortable-player-list` badge = label จาก level_id · page fetch levels → props. `club-levels-manager.tsx` อยู่ใน **club settings tab** (canManage-gated) — จัดการชุดระดับของก๊วน (เพิ่ม/แก้/ลบ definition). **แสดงเฉพาะเมื่อ `queue_settings.skill_level_enabled` (v0.25.0)** — ก๊วนที่ไม่ได้ใช้โหมด level_match จะไม่เห็นการ์ดนี้ (gate ใน `clubs/[id]/page.tsx`). legacy `club_players.level` text **DROPPED แล้ว** (migration `20260607000900`, introspect-confirmed 2026-06-10; level_id เป็น source of truth). tsc 0 · vitest 401 · build OK. live-smoke PASS (per_player + level badge render).
- **แก้ระดับผู้เล่นหลังเพิ่มแล้ว (v0.17.0, 2026-07-04):** เดิมตั้ง level_id ได้ครั้งเดียวตอนเพิ่ม guest เท่านั้น (LINE import = null, ไม่มีทางแก้ทีหลัง). เพิ่ม `updateClubPlayerDetailsAction` (partial patch: `display_name` guest-only / `level_id` / `note` — **แทน+ลบ** `renameClubGuestAction`) + `bulkSetClubPlayerLevelAction({clubId,playerIds[],levelId|null})`. ทั้งคู่ + `addGuestPlayerAction` validate level ผ่าน pure helper `resolveActiveLevelIds` (`src/lib/club/levels.ts`, 4 vitest) ว่า level อยู่ในชุด active ของก๊วน (club rows ถ้ามี ไม่งั้น global) — กัน FK รับ level ก๊วนอื่น. UI 3 จุดใน `sortable-player-list.tsx` (canManage): `LevelQuickSelect` (Select ในแถวแทน badge, save-on-change + revert, clobber-guard) · `EditPlayerForm` (ชื่อ guest-only + ระดับ + โน้ต, แทน RenameForm) · `BulkLevelDialog` (ปุ่ม "ตั้งระดับ" ใน BulkActionBar). ทุกจุดมี "ไม่มีระดับ" (sentinel `__none__`→null); non-manager เห็น badge เดิม. **E2E verified 2026-07-05:** `club-flow` เปิดแท็บ "ลงชื่อ / เช็คอิน" → quick-select ระดับให้ผู้เล่น → toast สำเร็จ → DB `club_players.level_id` persist ตรง (`npm run e2e` 11/11). **Updated 2026-07-08 (v0.21.0):** ถอด `LevelQuickSelect` (dropdown แก้ระดับ inline) + `SessionEditor` (ปุ่มแก้เวลา/เกม inline) ออกจากแถว — ระดับในแถวเป็น **badge อ่านอย่างเดียวทุกคน** (manager+viewer เหมือนกัน). `EditPlayerForm` เปลี่ยน inline-expand → **Dialog** (controlled `open`/`onOpenChange`, reseed-on-open guard ต่อ background refresh) รวม ชื่อ(guest) + ระดับ + **เวลาเริ่ม/เลิก** + โน้ต, save ครั้งเดียวผ่าน `updateClubPlayerDetailsAction` (ขยาย schema รับ `start_time?`/`end_time?` — fold เป็น patch แถวเดียว, ""/equal-club-window→null, **ไม่แตะ `games_played`**). ปุ่มดินสอในแถวย้ายไปกลุ่มขวา (หลัง CheckIn ก่อน Kick); `KickButton` เพิ่ม Tooltip (`kick.tooltip`, controlled dialog + Tooltip-wrapped trigger แทน DialogTrigger). **games_played manual entry ถอดทั้งหมด (2026-07-08):** ลบ `updateClubPlayerSessionAction` + `PlayerSessionSchema`/`PlayerSessionInput` (dead, 0 caller) + ถอด `games_played` จาก `bulkUpdateClubPlayerSessionAction`/`BulkSessionSchema` + games field ใน `BulkSessionDialog` (เหลือ start/end); `games_played` เป็น **auto-derived อย่างเดียว** (finish_club_match RPC +1, delete_club_match −1 floor 0 — read paths cost-summary/queue/batch-queue/public-view เดิมไม่แตะ). **จบแข่ง (InProgressRow) inline → Dialog:** ปุ่ม "จบแข่ง" (icon `Flag`) เปิด `<Dialog>` (controlled `finishOpen`, reseed games on open) — คะแนนรายเซ็ต + ปุ่มผู้ชนะ label = **ชื่อคู่จริง** ผ่าน `winnerWinsButton` (แทน `sideAWins`/`sideBWins` ที่ลบ) + `noResult` ซ่อนเมื่อ feeder + footer ยกเลิก; ทุกปุ่มคง Tooltip. i18n: +`winnerWinsButton`/`finishDialogTitle`/`finishDialogCancel`/`kick.tooltip`, −`sideAWins`/`sideBWins`/`sessionFieldGames`, relabel bulk session keys (ตัด "เกม"), ลบ orphan 7 keys (`sessionEditor{Saved,Title,Games,Save,Cancel}` + `level{Saved,SelectAriaLabel}`). `club.json` th/en 834/834 parity. tsc 0 · vitest 818 · build OK. **Add-form time (v0.28.0, 2026-07-12):** `AddGuestPlayer` (`add-guest-player.tsx`) รับ `start_time`/`end_time` ได้ตั้งแต่ตอนเพิ่ม — collapsible **"ตัวเลือกเพิ่มเติม"** (Base UI `Collapsible` + `ChevronDown`, `showMore` state, ยุบกลับเมื่อ submit สำเร็จ + ตอนปิดฟอร์ม) กาง 2 ช่อง `<Input type="time">` (placeholder = club window ผ่าน props `sessionStart`/`sessionEnd` ที่ thread จาก `clubs/[id]/page.tsx`); quick-add (ชื่อ·ระดับ·โน้ต) คงเดิม. `addGuestPlayerAction` ขยาย schema (`start_time`/`end_time` regex `TIME_RE` nullable — `TIME_RE` ย้ายขึ้น module-top เลี่ยง TDZ) + **2-step insert** (RPC `add_club_player` → capture `inserted.id` → `.update({start_time,end_time})` ตาม pattern `importClubPlayersAction`); ""/equal-club-window→null. i18n `club.addGuestPlayer.{moreOptions,timeStartLabel,timeEndLabel,timeHint}` th/en 845/845 parity. tsc 0 · vitest 825 · build OK · net-zero browser smoke PASS (add ไม่ใส่เวลา→null/null · add ใส่ 19:00–20:30→persist · console 0 error).
- **Tournament (ยังไม่ทำ):** `team_players`/`pairs.pair_level` + `computePairDivision`/thresholds ไม่แตะ — เมื่อทำ ต้อง map real=parseFloat(ค่าเดิม) เพื่อให้ pair_level + thresholds เท่าเดิม (impact วิเคราะห์แล้ว).

### Score Matrix View (2026-05-27)

- **New helper** `src/lib/tournament/score-matrix.ts` — `buildScoreMatrix(matches, competitorIds, unit)` → `Map<rowId, Map<colId, CellResult>>`.
  - `CellResult` discriminated union: `{state:"score", rowGames, colGames, rowPoints, colPoints, result:"W"|"L"|"D"}` | `{state:"scheduled"}` | `{state:"none"}`.
  - Processes all match statuses (completed + pending + in_progress) so `scheduled` vs `none` is distinct.
  - BYE guard: `completed && games.length > 0` → score; completed with empty games (BYE) or pending/in_progress → `scheduled` (only if current cell is `none`; never downgrades an existing `score`).
  - Matches sorted by `match_number` ASC before processing → deterministic last-write when multiple fixtures exist for a pair.
  - Cross-group guard: `aId / bId` must both be in the `competitorIds` Set (no cross-group contamination).
  - Diagonal (rowId === colId) not stored; component renders `—` based on index comparison.
- **New component** `src/components/tournament/score-matrix.tsx` (`"use client"`).
  - Props: `{ matches: Match[]; competitors: Competitor[]; unit: "team" | "pair" }`.
  - Uses shadcn `Table` family (`Table / TableHeader / TableBody / TableRow / TableHead / TableCell`).
  - Score cells: top line `{rowGames}:{colGames}` colored via `RESULT_TEXT_CLASS[result]`; bottom line `{rowPoints}-{colPoints}` in `text-[10px] text-muted-foreground tabular-nums`. `scheduled` → `·`; `none` → empty. Diagonal `—`.
  - Column headers + row headers: color dot + name wrapped in `<EntityLink>` (same entity type as `unit`). Row header is `<TableHead scope="row">` (a11y). Corner cell carries `<span class="sr-only">ทีม|คู่</span>`; color dots + diagonal `—` are `aria-hidden`.
  - No extra wrapper — shadcn `Table` already supplies the `overflow-x-auto` container, so wide matrices scroll horizontally on their own.
- **`group-stage.tsx` — GroupCard**: `const [view, setView] = useState<"list"|"matrix">("list")`. When `showMatches` is expanded, a segmented "ตาราง" / "Matrix" button pair (ghost, size sm, `aria-pressed`) appears top-right of the matches section. Toggling switches between `<ScoreMatrix unit="team" />` and `<MatchList />`.
- **`pair-stage.tsx` — division cards**: `const [matrixDivs, setMatrixDivs] = useState<Set<string>>(new Set())` keyed by `String(divKey)`. Inside each division `CollapsibleContent`, a "ตาราง" / "Matrix" button pair (`aria-pressed`) appears above the match list. Memoized `divisionCompetitorsByKey: Map<number|null, Competitor[]>` (deps `[matchesByDivision, pairCompetitorMap]`) supplies competitors to both `<ScoreMatrix unit="pair" />` and the standings tab — the old `getDivisionCompetitors` helper was removed.
- **Post-review hardening (2026-05-27)**: 6 findings from max-effort review of `80ae63a..f94ccb8` fixed same-day (a11y `aria-pressed`/`sr-only`/`aria-hidden`, dead-code `getDivisionCompetitors` removal, Pts-tooltip `tabIndex={0}`, footer dedup). `score-matrix.test.ts` grew 24 → 38 cases (tie game, all-ties, 3-competitor full matrix, scheduled→score promote, input immutability). 0 P0/P1-correctness. Total vitest 307.

### Color Summary (Group Stage)

- **Component**: `ColorSummary` + `buildColorSummary` ใน `src/components/tournament/group-stage.tsx`
- แสดงก่อน standings grid เมื่อ `completedMatches > 0` และ `hasGroups`
- `buildColorSummary(groups, teams)` — aggregate `leaguePoints` ต่อ `team.color` cross-group; sort desc; `useMemo`
- **Cards grid** `grid-cols-2 sm:grid-cols-4` — แต่ละสี: color ring (`--tw-ring-color` CSS variable) + pts + ชื่อทีม (truncate)
- **Bar chart** — horizontal bars ความกว้างตาม `pts/maxPts`; `Card`/`CardContent`; `transition-[width] duration-500`

### Team Summary (Dashboard Tab — moved 2026-05-22)

- **Component**: `TeamSummary` ใน `src/components/tournament/team-summary.tsx`
- Mounted ใน Dashboard tab (ไม่ใช่ Teams tab อีกแล้ว) ระหว่าง summary cards กับ Top performers; `TeamManager` ไม่รับ `matches` / `pairs` / `matchUnit` props แล้ว
- Team mode: `computeStandings(matches, "team", teamIds)` แล้ว map row.id → team
- Pair mode: aggregate `leaguePoints` ของทุก pair group by `pair.team_id`
- แสดงเมื่อ `completedMatches > 0 && teams.length >= 2`
- รูปแบบ: bar chart (recharts) — รับ `orientation: "vertical" | "horizontal"` prop จาก `tournament.settings.chart_orientation` ของ Dashboard parent; TV page passes `orientation={settings.chart_orientation}` ที่ call site เดิม

---

## Phase 9 — Match Schedule/Queue

- **DB**: `matches.queue_position int` (nullable; backfilled per tournament from `match_number` via `ROW_NUMBER() OVER (PARTITION BY tournament_id ORDER BY match_number)`); index `idx_matches_tournament_queue_position` on `(tournament_id, queue_position)`
- migration: `add_match_queue_position`
- **Types**: `Match.queue_position: number | null`
- **Server actions** (`src/lib/actions/matches.ts`):
  - `reorderMatchQueueAction(tournamentId, orderedMatchIds[])` — `assertCanEdit`; validates all IDs belong to tournament; bulk UPDATE `queue_position` per id; revalidatePath
  - `setMatchCourtAction({ matchId, tournamentId, court })` — trim empty → null; revalidatePath
  - `startMatchAction(matchId, tournamentId)` — set `status='in_progress'`; reject if completed/in_progress; LINE notify `🏸 เรียกแมตช์ #N (สนาม X)\n A vs B`; writeAuditLog `match_started`
- **Page query order**: `.order("queue_position", { ascending: true, nullsFirst: false }).order("match_number")` on both `/tournaments/[id]` and `/t/[token]`
- **Component**: `src/components/tournament/match-queue.tsx`
  - Sub-tabs (shadcn `Tabs`, default `pending`): รอแข่ง (`pending`, draggable when `canEdit`) · กำลังแข่ง (`in_progress`) · จบแล้ว (`completed`); each `TabsTrigger` shows a count `Badge`; "สถานะสนาม" card + "จัดคิวอัตโนมัติ" button stay attached to the รอแข่ง panel
  - DnD: `@dnd-kit/sortable` with `PointerSensor` `activationConstraint: { distance: 8 }`; only pending list is sortable
  - per-row: queue index `#N` · color dot + name vs name · court `<Input>` (onBlur save) · status badge · action button
  - actions: "เริ่ม" (pending → in_progress) · "จบแข่ง" (in_progress → opens `ScoreForm` inline) · "↺" reset (completed)
  - completed-row result line (2026-05-26): `ผล: A:B (<per-game list> · รวม X-Y) · ผู้ชนะ: …` — per-game scores via `match.games.map(g => `${g.a}-${g.b}`).join(", ")`, guarded by `games.length > 0` (BYE shows only `รวม`)
  - public share: `canEdit=false` → view-only (no drag, no court input, no buttons)
- **Wiring**:
  - `tournament-tabs.tsx` — `queueTab` prop + `showQueue` flag (TabId added `"queue"`); tab `ตารางคิว`; also `showSettings` flag — `ตั้งค่า` tab hidden when viewer is not owner/co-admin
  - `public-tournament-shell.tsx` — same `queue` slot + `showQueue` flag
  - tournament detail page + `/t/[token]/page.tsx` — `showQueue = allMatches.length > 0`; pass `competitorById = buildCompetitorMap(...)`; detail page passes `showSettings={canEdit}`
- **Permission**: Owner + co-admin = drag/court/start/end/reset + settings tab; public viewer = read-only, no settings tab
- **Loading UX**: all action buttons (queue reorder/start/reset, gen groups, gen matches, gen knockout, delete team/player/pair, status change) capture `useTransition` pending flag → `<Loader2 animate-spin />` swap + `disabled={pending}`

## Phase 10 — Smart Scheduling (courts, auto-rotate)

- **DB**: `tournaments.courts text[] default '{}'` — ordered list of court names
- migration: `add_tournaments_courts`
- **Types**: `Tournament.courts: string[]`
- **Server actions**:
  - `updateCourtsAction(tournamentId, names[])` (`tournaments.ts`) — owner only; trim + dedupe; revalidatePath + writeAuditLog `courts_updated`
  - `autoRotateQueueAction(tournamentId, restGap=2)` (`matches.ts`) — greedy reorder pending matches to avoid same player in last `restGap` placed matches; fetches `team_players` for team matches and `pairs.player_id_1/2` for pair matches; preserves the existing `queue_position` slot numbers (assigns new id ordering onto old slots)
  - `startMatchAction` updated — court occupancy guard: if `match.court` set and another match in_progress on same court, return `{ error: "สนาม X ถูกใช้แมตช์ #N อยู่" }`
- **Components**:
  - `src/components/tournament/court-manager.tsx` — DnD list (add/remove/reorder) of court names; mounted in Settings tab (owner-only); `updateCourtsAction` on every change
  - `match-queue.tsx` updates:
    - `courts: string[]` prop passed from page + threaded through Sortable/NonDraggable/ReadOnly rows
    - "สถานะสนาม" card above pending list — color-coded grid of all courts; green = ว่าง, amber = ถูกใช้ (shows match # + competitors)
    - Court field: `<Select>` from `courts` list when `courts.length > 0`, else fallback `<Input>` (free-text); `__none` sentinel value for "ไม่ระบุ"
    - "จัดคิวอัตโนมัติ" button (canEdit + pending.length >= 2) → calls `autoRotateQueueAction`; spinner via `useTransition`
- **Page wiring**: `tournament-detail` + `/t/[token]` pass `courts={t.courts ?? []}` to `MatchQueue`; settings tab includes `<CourtManager />` (owner-only)

### Phase 10 hardening (2026-05-17 review fixes)

- **C2/H1 — Atomic queue + court uniqueness**:
  - migration `add_matches_unique_court_in_progress` — partial UNIQUE index `(tournament_id, court) WHERE status='in_progress' AND court IS NOT NULL` — DB-level guarantee no two in-progress matches share a court
  - migration `rpc_reorder_tournament_queue` — `reorder_tournament_queue(p_tournament_id uuid, p_ordered_ids uuid[])` `SECURITY INVOKER` + `search_path = ''`, executable by `service_role` only; locks rows `FOR UPDATE`, two-pass write (NULL → 1..N) to dodge any future UNIQUE constraint on queue_position
  - `reorderMatchQueueAction` + `autoRotateQueueAction` switched to the RPC (single transaction); concurrent reorders now serialize
  - `startMatchAction` catches `code === '23505'` → `"สนาม X ถูกใช้อยู่ — เลือกสนามอื่นแล้วลองใหม่"`
- **H2 — `setMatchCourtAction` court guard**: pre-check rejects setting `court` to a value where another in-progress match holds it
- **H3 — Audit log coverage**: `reorderMatchQueueAction` (`queue_reordered`), `setMatchCourtAction` (`match_court_set`), `autoRotateQueueAction` (`queue_auto_rotated`) all write audit entries
- **H4 — auto-rotate seeds in-progress players**: when the result list is empty, `recent` is seeded with all players currently on court so the next pick rests them
- **H5 — Court name length cap**: client `maxLength={40}` on both `match-queue.tsx` and `court-manager.tsx`; server `setMatchCourtAction` slices to 40; `updateCourtsAction` trims+slices to 40 per name and caps the array at 50
- **Share-path revalidation**: new helper `revalidateTournamentPaths(sb, tournamentId)` looks up `share_token` and revalidates `/t/[token]` + `/t/[token]/tv` alongside the owner page; used by all queue/court actions
- **M1 — Deep-link tab redirect**: `tournament-tabs.tsx` `useEffect` strips `?tab=X` from URL when the tab isn't in `validTabs` for this viewer (e.g. `?tab=settings` as non-admin)
- **M2 — Court Select uses `useTransition`**: `match-queue.tsx` `courtPending` flag disables Select while in flight and prevents rapid interleaved writes
- **M3 — `CourtManager` debounce + serialize**: 250ms debounce on every edit; new save waits for the previous via `inFlightRef`; rapid drag/add/remove now coalesces to one server write

## Phase 11 — Pre-tournament Settings (feature flags)

- **DB**: `tournaments.settings jsonb NOT NULL DEFAULT '{}'`
- migration: `add_tournaments_settings`
- **Schema** (`src/lib/tournament/settings.ts`): zod `TournamentSettingsSchema`, `parseSettings(raw)`, `DEFAULT_SETTINGS`, `getTournamentSettings(tournamentId)` helper (fetches + parses; returns DEFAULT_SETTINGS on miss)
- **Types**: `Tournament.settings: Record<string, unknown>` (validated at parse boundary, not on the type)
- **Server action**: `updateTournamentSettingsAction(tournamentId, patch)` (`tournaments.ts`) — owner-only; deep-merges `line_notify`, `safeParse` via `TournamentSettingsSchema`, audit log `settings_updated` with diff keys, revalidates owner + share + TV paths

### Wired flags (11)

| Flag                               | Default | Wire point                                                                                                                                                    |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `line_notify.start`                | `true`  | `startMatchAction` → `notifyTournamentEvent("start", …)`                                                                                                      |
| `line_notify.score`                | `true`  | `recordMatchScoreAction` (background)                                                                                                                         |
| `line_notify.bracket`              | `true`  | `generateKnockoutAction` (2 paths)                                                                                                                            |
| `line_notify.status`               | `true`  | `updateTournamentStatusAction`                                                                                                                                |
| `auto_rotate_rest_gap` (0-5)       | `2`     | `autoRotateQueueAction(tournamentId, restGap?)` — when caller omits, reads setting                                                                            |
| `court_strict`                     | `true`  | `true` = `setMatchCourtAction` blocks assigning an occupied court (error toast). `false` = assignment allowed freely; Start button disabled client-side when court busy; DB index `uniq_matches_inprogress_court` still enforces at start time as defense-in-depth |
| `color_summary`                    | `true`  | `GroupStage` prop `showColorSummary`; owner page + `/t/[token]`                                                                                               |
| `export_visible`                   | `true`  | Owner Settings tab wraps `ExportButtons`; `PublicHero` prop `showExport`                                                                                      |
| `allow_force_bracket_reset`        | `false` | `resetMatchScoreAction` — bypasses "next match completed" guard for upper + lower                                                                             |
| `allow_manual_match_after_bracket` | `true`  | `createManualMatchAction` — rejects when `false` AND knockout matches exist                                                                                   |
| `auto_advance_next`                | `false` | `recordMatchScoreAction` post-RPC — picks first pending by `queue_position`, sets `in_progress` + inherits `court`; 23505 on court collision silently skipped |
| `realtime_enabled`                 | `true`  | `TournamentLiveWrapper` prop `realtimeEnabled`; skips Supabase subscribe                                                                                      |
| `audit_log_enabled`                | `true`  | `writeAuditLog` fetches settings + early-returns when `false` (1 extra column read per write — acceptable for the current write volume)                       |
| `match_cooldown_minutes` (0-30)    | `0`     | `startMatchAction` reads latest `audit_logs` row with `event_type='match_started'` for this tournament; rejects if `now - created_at < cooldown`              |
| `require_court_to_start`           | `false` | `startMatchAction` (server gate) + `match-queue.tsx` (button disabled + tooltip)                                                                              |
| `require_checkin`                  | `false` | `startMatchAction` (server gate — blocks if any player has `checked_in_at IS NULL`) + `recordMatchScoreAction` auto-advance filter (skips candidates with unready players) — see Phase 12. |

**Cut from Phase 11**: `require_checkin` — implemented in Phase 12 (see below).

### Notifier helper

- `src/lib/notification/line.ts` — new `notifyTournamentEvent(tournamentId, event, text)` reads settings + short-circuits when `line_notify[event] === false`, otherwise delegates to `notifyTournamentAdmins`
- All 5 previous call sites swapped (`notifyTournamentAdmins` → `notifyTournamentEvent` + event key)

### UI

- **`SettingsManager`** (`src/components/tournament/settings-manager.tsx`) — owner+co-admin Card, mounted in Settings tab (canEdit); rendered before `ShareControls`/`CoAdminControls` which remain owner-only
- 3 sections: การแจ้งเตือน LINE · การจัดคิว · การแสดงผล + Privacy (icons: `Bell`, `ListOrdered`, `EyeOff`)
- `ToggleRow` (Checkbox + Label + description) and `NumberRow` (Input type=number, clamped to schema bounds)
- Auto-save: 500ms debounce + `inFlightRef` serializes concurrent saves; `Loader2` in header during pending; toast.error on failure
- `commit(patch, next)` keeps client state optimistic; deep-merges `line_notify` via dedicated `updateNotify(key, value)`
- Unmount-flush: cleanup callback fires any pending debounced patch via `pendingPatchRef` so navigating away mid-debounce doesn't drop the toggle

### Phase 11 hardening (review fixes)

- **B-1** `audit.ts` `writeAuditLog` — wrap full body in `try/catch`; the new `getTournamentSettings` pre-flight could throw on DB error and crash callers. Best-effort logging restored.
- **B-2** `matches.ts` `resetMatchScoreAction` — when `allow_force_bracket_reset` lets the operation through and `next_match` (or `loser_next_match`) is already `completed`, also reset that row (`games=[]`, scores null, `winner_id=null`, `status=pending`) — not just clear the slot — so the bracket doesn't keep an orphaned winner pointing at an empty slot. Single-level cascade; deeper rounds still need a manual second reset.
- **B-3** `matches.ts` `recordMatchScoreAction` auto-advance — after a successful promote update, call `revalidateTournamentPaths` and `writeAuditLog({ event_type: "match_started", description: "เริ่มแมตช์ #N (auto-advance) ..." })` so the cooldown gate counts the auto-promoted match and the queue UI refreshes. LINE notify still skipped (Caveat).
- **B-4** `settings-manager.tsx` — track `pendingPatchRef` alongside the debounce timer; cleanup callback flushes any queued patch fire-and-forget. Also coalesces multiple debounced toggles into one final write.
- **M-3 / N-1** `match-queue.tsx` — drop the per-tab `Card` wrapper inside each `TabsContent`; tab labels carry the count badge already. Pending tab gets a slim header row (drag hint + auto-rotate button); the three lists render flat inside `TabsContent`.

### Caveats

- **`court_strict`**: now fully wired — gates `setMatchCourtAction` server-side (strict=true blocks assignment of occupied courts) and disables the Start button client-side (strict=false allows assignment but blocks start when court busy). DB index `uniq_matches_inprogress_court` remains as defense-in-depth at start time regardless of flag value.
- **`audit_log_enabled`**: caller pays one extra read per write. Acceptable now; cache later if write volume grows.
- **`auto_advance_next`**: no LINE notify on the auto-promoted match (different code path); add later if needed.
- **`allow_force_bracket_reset`**: single-level cascade only — resets `next_match` / `loser_next_match` one hop. If that row's downstream rounds are also completed, a second manual reset is required. A recursive cascade would need a Postgres RPC.

### Queue # lock + chunked bracket priority (2026-05-19)

- **Queue # lock on start**: `MatchQueue` rows now display `match.queue_position ?? match.match_number` instead of immutable `match_number`. Pending rows show position-in-queue (`1..N`); in-progress/completed rows show the `queue_position` snapshot from the moment status flipped (RPC `reorder_tournament_queue` only touches rows in the supplied ID list, which is always pending-only).
  - New helpers in `src/lib/actions/matches.ts` (Internal helpers section):
    - `nextPendingTailPosition(sb, tournamentId)` — returns `max(queue_position)+1` of pending rows; `1` when empty
    - `renumberPendingQueue(sb, tournamentId)` — fetches pending IDs in current order and calls `reorder_tournament_queue` RPC so they get `1..N`
  - `startMatchAction` calls `renumberPendingQueue` after audit + LINE so the gap collapses; started match keeps its old `queue_position` as the lock number
  - `recordMatchScoreAction` auto-advance path calls `renumberPendingQueue` after promoting next match
  - `cancelMatchAction` (in_progress → pending) sets `queue_position = nextPendingTailPosition` in the same update payload — match goes to end of queue
  - `resetMatchScoreAction` (completed → pending) does the same
  - `createManualMatchAction` includes `queue_position = nextPendingTailPosition` in the insert payload so manual rows append at the tail
  - `match-queue.tsx`: removed unused `index` prop from `SortableQueueRow` / `NonDraggableRow` / `QueueRowReadOnly` / `QueueRowBody` (no longer needed since display reads from match data)
- **N-division queue ordering** (`queue_division_order` + `queue_division_priority`):
  - Schema (`src/lib/tournament/settings.ts`): `queue_division_order: "sequential"|"interleaved"|"chunked"` (default `"interleaved"`); `queue_division_priority: number[]` (1-based div numbers, `[]` = natural 1..N order); `queue_chunk_size: number (1..50, default 10)`. `queue_bracket_preference` removed (legacy values translated by `normalizeLegacy()`).
  - `autoRotateQueueAction` uses `queue_division_order` + `queue_division_priority` to bucket and sequence matches across N divisions.
  - `settings-manager.tsx`: Select for `queue_division_order` (สลับ/ตามลำดับ/เป็นชุด) + `DivisionPriorityRow` (comma-separated text input, sanitize on blur) when order ≠ interleaved + `NumberRow` for `queue_chunk_size` when chunked.
- **Match queue UX**:
  - Division badge ("บน" amber / "ล่าง" sky) shown after `#match_number` in each row — uses `match.bracket` for knockout, `match.division` for group rounds
  - Competitor names hug `vs` via right-aligned A + left-aligned B with color dot mirrored to the inner side
- **Perf**:
  - `MatchRow` wrapped in `React.memo` with custom comparator (compares match id/status/games/scores/winner/court/queue_position + `competitorById` ref)
  - `pair-stage.tsx` + `group-stage.tsx`: `useMemo` for `pairCompetitorMap`/`competitorMap`/`flatTeams`/`teamById` so memo can actually skip
  - `TournamentTabs` + `PublicTournamentShell`: lazy-mount — `mounted: Set<TabId>` starts with active tab; other tabs mount on first visit, stay mounted afterwards
  - `MatchList` (new component, replaces inline MatchRow map in pair/group stages): renders full DOM with `content-visibility: auto` + `contain-intrinsic-size: auto Npx` so off-screen rows skip paint/layout while staying searchable + printable. Virtualization (`@tanstack/react-virtual`) explored then dropped — ResizeObserver/ref-timing made first paint show empty rows; `content-visibility` is the simpler win.
  - `pair-stage.tsx`: groups default to collapsed (`openGroups[id] === true`); click chevron to expand
- **KO gate + cascade reset**: `startMatchAction` blocks KO R1 until same-division group matches all `completed`; regenerating groups/group-matches/pair-matches cascades into `clearKnockoutMatches` + `resetGroupTeamStandings` (denormalized standings on `group_teams`)
- **`cancelMatchAction`** (new): reverts in_progress → pending; UI button "ยกเลิก" in queue row
- **Thai label sweep**: UI strings "Knockout"/"knockout" → "น็อคเอ้า" across tab label, format options (`group_knockout` label → "แบ่งกลุ่ม + น็อคเอ้า"), headings, descriptions, CSV fallback ("Grand Final" → "ชิงชนะเลิศ"), LINE notify, settings descriptions. DB enums and URL params unchanged. PairStage sub-tabs: "คู่" → "จับคู่", "คะแนนกลุ่ม" → "คะแนน". `Lower bracket` label → "มีสายล่าง". `สร้าง bracket` button → "สร้างสาย".
- **Realtime fix**: migration `realtime_replica_identity_full` sets `REPLICA IDENTITY FULL` on `matches` + `tournaments` so postgres_changes payloads include the `tournament_id` filter column; `TournamentLiveWrapper` drops the `isOngoing` gate so draft/registering tournaments also subscribe.
- **Queue position seeding**: migration `replace_tournament_matches_set_queue_position` updates the RPC to seed `queue_position` from `match_number` on bulk insert (so freshly-generated matches sort correctly from the start).
- **Empty date crash fix**: `createTournamentAction` uses `emptyToNull` zod transform on `venue`/`start_date`/`end_date` (Postgres rejected `""` for date columns).
- **form-errors helper**: new `src/lib/form-errors.ts` normalizes TanStack Form `ZodIssue[]` → `{ message }` for shadcn `<FieldError>` rendering (was showing `[object Object]`). Applied to 7 forms.
- **Court Select placeholder**: `match-queue.tsx` `SelectValue` uses children-as-function to render "ว่าง" for the `__none` sentinel (was leaking the raw string).

### Phase 11 review fixes (2026-05-17)

- **A — auto_advance TBD filter**: `recordMatchScoreAction` auto-advance previously picked any pending match by `queue_position`. KO matches awaiting a prior round's winner have `team_a_id=null` or `pair_a_id=null` and were getting promoted to in_progress with `— vs Team B` shown in UI. Fix: pull a 20-row queue window, filter in JS for fully-populated competitor slots (`(pair_a && pair_b) OR (team_a && team_b)`), promote the first one. Supabase JS filter cannot express the OR-pair, hence the JS pass.
- **B — cooldown source decoupled from audit_log**: `match_cooldown_minutes` previously read `audit_logs` rows with `event_type='match_started'`. When `audit_log_enabled=false`, no row was written, so cooldown silently never triggered. Fix: new column `matches.started_at timestamptz` (migration `add_matches_started_at`); set in `startMatchAction` + `auto_advance_next`; cooldown reads `matches.started_at` desc. Backfill ran `UPDATE matches SET started_at=NOW() WHERE status='in_progress'` so pre-existing in-progress rows count.
- **D — parseSettings per-field fallback**: schema-level `safeParse` previously dropped every valid field if one was invalid (e.g. manual DB edit corrupting a single key). Fix: try whole-object parse first (fast path); on failure, walk `TournamentSettingsSchema.shape`, run `safeParse` per field, keep the parsed value if it succeeds, fall back to `DEFAULT_SETTINGS` per key. **Nested-object recovery (2026-06-09):** the per-field loop re-parsed each top-level key as a whole, so one corrupt sub-flag of `line_notify` (the only nested object) reset all four flags to default — wiping a user's `score:false`/`bracket:false`. `recoverObjectField(objSchema, value, fallback)` now recovers nested-object sub-values individually (keeps each sub-flag that parses; only the corrupt one falls back); the loop routes `key === "line_notify"` through it. Read-time only — the write path (`updateTournamentSettingsAction`) keeps strict whole-object validation (no schema `.catch()`). Arrays (`queue_division_priority`) still fall back wholesale by design.

## Todo

(Phase 12 DONE — see below.)

### 📥 User requests — LINE club-link UX (เพิ่ม 2026-07-15)

1. **ผูกก๊วน/ผู้เล่นครั้งเดียวใช้ได้ตลอด (persistent link)** — 📐 **DESIGNED + GRILLED ✅ 2026-07-15, user เลือกทาง C เต็มรูป (ก๊วนถาวร + นัด); decisions ล็อกครบ 15 ข้อ** (ดู "### 📐 Design — ผูกครั้งเดียวใช้ได้ตลอด" ด้านล่าง); EXPAND + backfill **APPLIED prod**; **P1 (webhook/บิล/join resolve ผ่าน series + member auto-link) ✅ SHIPPED PROD 2026-07-15 (v0.42.0** — ship-check ครบ + live browser smoke; PR #66→#69 develop→#70 master, deploy READY; รายละเอียดเต็มใน § "Migration prod" ข้อ 3 ด้านล่าง); **P2 (series home + จัดก๊วน + URL restructure + ถอด preset) ✅ SHIPPED PROD 2026-07-16 (v0.43.0, PR #71 → release #74, deploy READY + legacy-redirect verified on prod)** · **P3 + P4 ✅ SHIPPED PROD 2026-07-16 (v0.45.0, release #75)** — payment/receipt/co-admins ระดับก๊วน (migration `20260715000500` applied) + แท็บสถิติข้ามนัด; **เหลือเฟสเดียว: CONTRACT** (drop `clubs.line_group_id`/`join_token`/payment legacy + `club_presets` — R0 gate รอ user สั่ง หลังยืนยันทุก path อ่านผ่าน series แล้วสักระยะ).
2. **ช่องข้อความผูกก๊วน LINE — เอา scrollbar ออก** — UI bug. **ชี้เป้าแล้ว (explore 2026-07-15):** `src/components/club/club-link-controls.tsx` component `BindCommandRow` (~บรรทัด 73) — `<code className="h-8 flex-1 overflow-x-auto whitespace-nowrap ...">` ใส่ `ผูกก๊วน <token>` ที่ token เป็น UUID เต็ม → เกิด horizontal scrollbar ในกล่องสูงคงที่. แก้ด้วย wrap/truncate+copy หรือ auto-fit แทน overflow-x-auto.
3. **Site admin ยกเลิกการเชื่อมกลุ่ม LINE ได้ทุกก๊วน** — ✅ **SHIPPED 2026-07-16 (v0.46.0)** ตาม 5 decisions ที่ grill ไว้ + ปรับเป็น binding model ระดับก๊วนถาวร (inventory = series UNION legacy orphan; ยกเลิก series ผ่าน `clearBindingBySeriesId`, orphan เคลียร์เฉพาะแถวตัวเอง; แจ้ง owner ผ่าน template `adminUnbindNotice` แก้ได้ที่ /admin). เดิม: การ์ด `AdminLineBindingsManager` ใน `/admin` — ตารางทุกก๊วนที่ `line_group_id IS NOT NULL` (ชื่อก๊วน/เจ้าของ/วันเล่น) + ยกเลิกรายก๊วน + **ปุ่ม bulk ยกเลิกทั้งหมด**; confirm dialog ธรรมดาทั้งคู่ (bulk ระบุจำนวน+ผลกระทบ); ตัดแล้ว **push LINE 1:1 แจ้ง owner** ต่อก๊วน (fire-and-forget, ข้อความเป็น bot-message template แก้ได้ที่ /admin); actions gate ด้วย site-admin assert (`src/lib/auth/site-admin.ts`); build บน `clubs.line_group_id` ปัจจุบัน — จด consumer ไว้ใน ADR 0002 แล้ว (P1 ก๊วนถาวร repoint ตาม). คำใน glossary: "Site admin" เพิ่มใน CONTEXT.md แล้ว (ห้ามเรียกสั้นๆ ว่า "admin" — ชนกับ Manager).
4. **ปุ่ม reset level ของก๊วนนั้นๆ (club-scoped level reset)** — เพิ่มปุ่มให้ owner/co-admin รีเซ็ต level ผู้เล่นในก๊วนนั้น. **ต้อง clarify scope ก่อนทำ:** รีเซ็ตเป็นค่าอะไร (null / ค่า default), กระทบเฉพาะ `club_players` ของก๊วนนี้หรือ level FK ทั้งระบบ (levels เป็น global source of truth — ดู memory `level-system-pending-drops.md`), และเป็น R1 (แก้ข้อมูลผู้เล่นหลายแถว) ต้อง confirm dialog + audit. **หมายเหตุ (grill 2026-07-15):** level ของสมาชิกจะกลาย write-through ที่ `series_members.default_level_id` ตาม design ก๊วนถาวร → reset level ควร implement ที่ระดับสมาชิกก๊วน (จุดเดียวจบ) หลัง P2 ship.

### 📐 Design — "ผูกครั้งเดียวใช้ได้ตลอด" ทาง C เต็มรูป: ก๊วนถาวร + นัด — ออกแบบ 2026-07-15 (user เลือก C จาก 3 ทาง A/C1/C-full), ยังไม่ implement

> **เอกสารคู่กัน:** ADR `docs/adr/0002-club-series-persistent-entity.md` (decision record + code facts พร้อม file:line + guardrails สำหรับ implementer) · glossary `CONTEXT.md` § "Club series (ก๊วนถาวร + นัด)" (คำเรียกมาตรฐาน). อ่าน ADR 0002 ก่อนเริ่ม implement เสมอ.

**ปัญหา:** 1 `clubs` row = 1 นัด → binding ทุกตัวตายตามนัด: `line_group_id` + `join_token` ไม่อยู่ใน preset (ต้องพิมพ์ `ผูกก๊วน <token>` ในกลุ่ม + แชร์ลิงก์ใหม่ทุกนัด); `club_players.profile_id` ติดมาผ่าน preset แบบ snapshot ที่ stale; known-profile picker derive จาก `club_link_requests` ซึ่ง CASCADE ตายเมื่อลบ club เก่า. **ระบบเรียก "นัด" ว่า "ก๊วน" — ไม่มีตัวตนถาวรของก๊วนจริง (เช่น MUGGLE) ให้ binding/สมาชิกเกาะข้ามนัด.**

**ทางเลือกที่พิจารณาแล้วตัดทิ้ง:** (A) clone-นัด + ย้าย `line_group_id`/`join_token` ข้าม row — เล็กสุดแต่เป็นท่าแฮ็ก: บิลนัดเก่าดับหลังย้าย binding, ไม่เปิดทางฟีเจอร์ข้ามนัด; (C1) series-lite additive — ครึ่งทาง. **user เลือก C เต็มรูป 2026-07-15.**

#### โมเดลเป้าหมาย

- **`club_series`** (ก๊วนถาวร — "MUGGLE"): `id, owner_id FK profiles, name, line_group_id text UNIQUE?, join_token text UNIQUE?, active_session_id FK clubs? (นัดปัจจุบัน — pointer ชัดๆ), is_adhoc bool default false (ก๊วนเฉพาะกิจซ่อน — decision #12), archived_at timestamptz? (decision #13), session_defaults jsonb NOT NULL default '{}' (decision #15), created_at` + (P3 ยกของถาวรขึ้น) promptpay/receipt config, co-admins. RLS-on no-policy (service-role only ตาม invariant ตารางก๊วน). **ผูกกลุ่มไลน์ + join link ที่นี่ครั้งเดียวตลอดชีพ — ไม่มีการย้าย binding, บิลนัดเก่า push ได้ตลอด** (resolve นัด → series → `line_group_id`).
- **`series_members`** (ทะเบียนสมาชิกถาวร): `series_id FK CASCADE, profile_id FK profiles **nullable** (null = สมาชิกชื่ออย่างเดียว ไม่มี LINE — decision #11), canonical_name text, default_level_id FK levels?, is_regular bool default true (ขาประจำ — seed นัดใหม่; toggle ในหน้าสมาชิก), first/last_linked_at, partial UNIQUE(series_id, profile_id) WHERE profile_id IS NOT NULL`. scope ด้วย series (ไม่ใช่ owner) — กันชื่อชนข้ามก๊วนของ owner เดียวกันโดยธรรมชาติ.
- **`series_partner_pairs`** (คู่ประจำระดับก๊วน — grill Q6): คู่ `member_id` สองคน; ตอนเปิดนัดระบบ instantiate เป็น `club_locked_pairs` ของนัดให้อัตโนมัติ — **queue engine ไม่แตะเลย** (มันอ่าน locked pairs ต่อนัดเหมือนเดิม); ในนัดปลด/เพิ่มล็อคชั่วคราวได้อิสระ ไม่เขียนย้อนขึ้นก๊วน. **เข้า P2.**
- **`clubs`** = นัด (คอลัมน์เดิมคงหมด — `club_players`/`club_matches`/billing ยัง key ด้วย `club_id` ไม่ rekey): เพิ่ม `series_id FK club_series` (nullable — นัด legacy/standalone = null). `line_group_id`/`join_token` บน clubs → deprecated หลัง backfill (คง column ช่วง transition, drop ตอน CONTRACT).
- **`club_players`** = attendance ของนัด: เพิ่ม `member_id FK series_members?` (nullable — walk-in ไม่มี membership ได้); `profile_id` เดิมคงไว้ (derive จาก member ตอน link).
- **`club_link_requests`** → กลายเป็น **คำขอสมัครสมาชิกก๊วน** scope ระดับ series (สมัครครั้งเดียว ไม่ใช่ต่อนัด); pool UI อยู่หน้าก๊วน.
- **การแบ่งหน้าที่:** membership/identity/LINE link/คู่ประจำ/level default = ระดับก๊วน; roster/คิว/แมตช์/บิล = ระดับนัด (โค้ด queue/cost/billing เดิมแทบไม่แตะ).

#### Decisions จาก grilling (2026-07-15 — ล็อกแล้วทั้ง 10 ข้อ)

1. **URL/IA:** ก๊วนถาวรครอง `/clubs/[id]` (id = series UUID); นัดอยู่ `/clubs/[seriesId]/s/[sessionId]`; `/clubs/<uuid นัดเก่า>` → 302 redirect ไป path ใหม่ (UUID ไม่ชนกัน lookup ได้); `/clubs` list = รายชื่อก๊วนถาวร. (ข้อเท็จจริงรองรับ: ไม่มี URL หน้าก๊วนหลุดออกนอกระบบ — บิล LINE เป็น text+mention ล้วน, ลิงก์แชร์มีแค่ `/clubs/join/[token]` ซึ่งอิง token)
2. **เปิดนัด seed roster:** สมาชิก `is_regular` ลง roster อัตโนมัติทั้งหมด (พร้อม level/link/member_id) — ไม่มี dialog ติ๊กเลือก, ปรับคนด้วย UI เดิมในหน้านัด; owner + co-admin เปิดนัดได้.
3. **นัด active:** pointer `club_series.active_session_id` — set อัตโนมัติตอนเปิดนัด + manager สลับเองได้ + badge "นัดปัจจุบัน" ใน UI; ไม่ใช้ date-heuristic. membership upsert เกิดระดับก๊วนเสมอ; pointer ใช้ตัดสินแค่ roster นัดไหนถูก auto-link. ไม่บล็อกการเปิดนัดใหม่ขณะนัดเก่ายังไม่ปิดบิล (บิลนัดเก่า push ได้ตลอดเพราะ binding อยู่บน series).
4. **Trust auto-link (ผ่อน ADR 0001):** สมาชิกที่เคยยืนยันแล้ว → auto-link เต็ม: ชื่อ roster ตรง exact+unique+ช่องว่าง → ผูกทันทีไม่ผ่าน manager (กติกาชุดเดียวกับ keyword self-link); กำกวม → pool + badge "สมาชิก — ชื่อเดิม X"; คนใหม่ → manager ยืนยันครั้งแรกครั้งเดียว (trust anchor เดิม).
5. **Backfill:** auto จับกลุ่ม `(owner_id, name)` exact → ทำ preview จาก prod ให้ user เคาะอนุมัติก่อน apply; ย้าย binding ขึ้น series (ตัวล่าสุด non-null ชนะ); สร้าง `series_members` จาก distinct `profile_id` links; stamp `member_id`; ชื่อเพี้ยนตัดสิน merge มือรายกรณี.
6. **คู่ประจำ:** ระดับก๊วน + seed ลงนัดอัตโนมัติ — **เข้า P2** (ไม่รอ P3).
7. **Level write-through:** แก้ level ผู้เล่น (ที่เป็นสมาชิก) ในหน้านัด = อัปเดต `series_members.default_level_id` ด้วยเสมอ; walk-in เป็น per-นัด ธรรมชาติ. (TODO "reset level ของก๊วน" implement ที่ระดับสมาชิกหลัง P2)
8. **Preset: deprecate ทิ้งหลัง P2** (user เลือกแรงกว่า rec) — ถอด UI + actions ทันทีที่ปุ่มเปิดนัด ship; ตาราง `club_presets` drop ตอน CONTRACT.
9. **RSVP: แยก PRD ใหม่** หลัง P2 ship — P4 เหลือสถิติข้ามนัดอย่างเดียว (read-only, เสี่ยงต่ำ).
10. **คำเรียก UI (ปรับเป็น hybrid 2026-07-15):** ชั้นถาวร = **"ก๊วน"**, ชั้นรายครั้ง (noun/entity) = **"นัด"** ("นัดปัจจุบัน" / "ประวัตินัด" / "นัดวันพุธ") — แต่**ปุ่ม action หลักสำหรับเปิดนัดใช้ "จัดก๊วน"** (verb, ภาษาพูดจริงของคนเล่นแบด) แทน "เปิดนัดใหม่"; ห้ามใช้ "จัดก๊วน" เป็นคำนามเรียก entity (กันคำ "ก๊วน" ซ้อนสองชั้น); i18n key ใหม่ทั้ง th/en parity.
11. **สมาชิกไม่มี LINE ได้ (grill รอบ 2):** `series_members.profile_id` เป็น **nullable** — สมาชิก 2 แบบ: ผูก LINE (รับบิล/mention ได้) กับ **ชื่ออย่างเดียว** (manager เพิ่มเอง, seed ตอนจัดก๊วนได้เหมือนกัน); ผูก LINE ทีหลัง = upgrade in-place ผ่าน flow auto-link เดิม; unique เปลี่ยนเป็น partial `UNIQUE(series_id, profile_id) WHERE profile_id IS NOT NULL` (mirror โครง guest/linked ของ `club_players`).
12. **นัดเฉพาะกิจ (ก๊วนเล่นครั้ง-สองครั้ง) คงอยู่ + ได้ LINE ครบ:** user เลือกให้สร้างนัดแบบไม่มีก๊วนถาวรได้ และมีฟีเจอร์ LINE เต็ม → **implement เป็น "ก๊วนเฉพาะกิจซ่อน"**: การสร้างนัดเฉพาะกิจ = auto-create `club_series` (`is_adhoc=true`, ไม่บังคับตั้งชื่อ, ไม่โชว์เป็นก๊วนเต็มตัวใน list — โชว์เป็นรายการ "เฉพาะกิจ" ชี้ตรงเข้านัด) + นัด 1 นัด — UX ขั้นตอนเดียวเหมือนเดิมแต่ binding LINE วิ่งผ่านกลไก series **ทางเดียวทั้งระบบ** (webhook/บิล/join logic ชุดเดียว, CONTRACT drop คอลัมน์ legacy เดินต่อได้); ปุ่ม **"อัปเกรดเป็นก๊วนถาวร"** = ตั้งชื่อ + flip `is_adhoc` (ข้อมูล/สมาชิก/binding อยู่ครบแล้ว). ลบนัดสุดท้ายของก๊วนเฉพาะกิจ = ลบ series ซ่อนตามไปด้วย (กัน orphan).
13. **ลบก๊วนถาวร:** **บล็อกถ้ายังมีนัดเหลือ** (ต้องลบนัดหมดก่อน) + เพิ่ม **archive** (`archived_at` — ซ่อนจาก list, ประวัติอยู่ครบ, กู้คืนได้) สำหรับก๊วนเลิกเล่น; ก๊วนเฉพาะกิจนัดเดียวยังลบง่ายเหมือนเดิม.
14. **Webhook rebind ชนกัน:** `ผูกก๊วน <token>` ในกลุ่มที่ผูกก๊วนอื่นอยู่ (หรือก๊วนผูกกลุ่มอื่นอยู่) → **error ชัดๆ ทั้งสองทิศ ไม่ย้ายอัตโนมัติ** — bot ตอบชื่อก๊วนที่ผูกอยู่ + ให้กดปลดในแอปก่อน (`unbindClubLineGroupAction` ระดับ series) — กัน binding หายเงียบ.
15. **Config นัดใหม่ = หน้า default ของก๊วน (user เลือก, ต่างจาก rec copy-forward):** เพิ่ม `club_series.session_defaults jsonb` (venue, เวลาเริ่ม-เลิก, max_players, court_fee, shuttle_price, queue_settings เต็ม block, named courts) — แก้ในหน้าตั้งค่าก๊วน; "จัดก๊วน" อ่านจากนี่เสมอ; แก้ config ในนัดไม่เขียนย้อนขึ้น default (explicit ไม่ implicit); ฟอร์มสร้างก๊วนครั้งแรก seed `session_defaults` ในตัว; backfill seed จากนัดล่าสุดของแต่ละก๊วน. = series กลายเป็น "preset ที่มีชีวิต" เต็มตัว สอดคล้อง decision #8 (ถอด preset).

#### Flows หลัก

- **ตั้งก๊วนครั้งเดียว:** สร้าง series → gen `join_token` → พิมพ์ `ผูกก๊วน <token>` ในกลุ่ม LINE (webhook เขียน `line_group_id` ที่ series) — จบ ไม่ต้องทำซ้ำอีก.
- **เปิดนัด:** จากหน้าก๊วน เลือกวัน → insert `clubs` row (`series_id` set, active pointer ชี้มาที่นัดนี้) + seed roster จากขาประจำ + instantiate คู่ประจำเป็น `club_locked_pairs` — ชื่อ+`member_id`+`profile_id`+level ติดมาครบ ไม่ต้องผูกอะไรเลย.
- **ผู้เล่นผูกครั้งเดียวตลอดชีพ:** join link (ระดับก๊วน) → LINE login → **ครั้งแรก**: manager ยืนยัน 1 ครั้ง → upsert `series_members`; **ครั้งต่อไป**: auto-link ตาม decision #4. keyword `เชื่อมไลน์ <ชื่อ>` resolve group → series → นัด active (pointer) + upsert membership.
- **ขาเขียน registry อัตโนมัติ:** `linkClubPlayerAction` · `linkKnownProfileAction` · webhook `resolveSelfLink` → upsert `series_members` ทุกครั้งที่ link สำเร็จ. **Unlink ในนัด ≠ ลบสมาชิก**; ลบสมาชิกออกจากก๊วนเป็น action แยก (เคสผูกผิดคน).
- **Group bill:** `pushGroupBillsAction` อ่าน `line_group_id` ผ่าน series ของนัดนั้น (fallback legacy `clubs.line_group_id` ช่วง transition) — นัดไหนก็ push ได้.
- PII: ตารางใหม่อ้าง `profile_id` เท่านั้น ไม่แตะ `line_user_id`; ไม่ส่งลง client.

#### Migration prod (EXPAND → cutover → contract)

1. **EXPAND (additive DDL):** ✅ **APPLIED prod 2026-07-15** (migration `20260715000200_club_series_expand`) — `club_series` (+`active_session_id`/`is_adhoc`/`archived_at`/`session_defaults`) + `series_members` (profile_id nullable, partial unique) + `series_partner_pairs` + `clubs.series_id` (FK **RESTRICT** = decision #13 ระดับ DB) + `club_players.member_id`; RLS-on no-policy ทุกตารางใหม่; FK indexes ครบ. โค้ด live ไม่แตะคอลัมน์ใหม่ = zero behavior change (verified: หลัง apply ไม่มี error). RPC ใหม่ในอนาคตต้อง `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`.
2. **Backfill (assisted):** ✅ **APPLIED prod 2026-07-15** (migration `20260715000300_club_series_backfill`; preview อนุมัติโดย user — **auto (owner,name) ล้วน ไม่ merge มือ**: MUGGLE×2 เจ้าของแยกกัน, "MUGGLE TUESDAY "/"อังคาร" แยกตามข้อมูล). ผล verify ตรง preview เป๊ะ: **6 series / 8 นัด linked (0 orphan) / 3 members (BEEPANG·BEE·PANG พร้อม level) / 3 attendance stamped / binding parity 0 mismatch / active pointer + session_defaults ครบทุก series**. Binding เป็น **copy ไม่ move** — legacy `clubs.line_group_id`/`join_token` ยังอยู่ให้โค้ด live ใช้จน P1 สลับ. `session_defaults` shape ที่ seed: `{venue, start_time, end_time, max_players, court_fee, shuttle_price, court_split, shuttle_split, courts, queue_settings}` — P2 เขียน zod ตามนี้.
3. **Cutover เป็น PR ชุด** (แต่ละตัว green + deployable): **(P2) ✅ IMPLEMENTED + ship-check PASS 2026-07-15 (v0.43.0, branch `feat/club-series-p2`, รอ merge)** — series home 3 แท็บ (ภาพรวม/สมาชิก/ตั้งค่า) · "จัดก๊วน" (`openClubSessionAction`: seed ขาประจำ+level remap สู่ global set+คู่ล็อค+carry co-admins+active pointer, rollback ครบ) · URL: `/clubs` = รายชื่อก๊วน (+โซนเฉพาะกิจ+เก็บถาวร/กู้คืน), `/clubs/[seriesId]/s/[sessionId]` canonical, legacy redirect ผ่าน dispatcher · `session_defaults` editor เต็ม (รวม queue block ผ่าน `ClubQueueSettings` onSave) + `adoptSessionAsDefaultsAction` · member CRUD + reset levels + partner pairs + level write-through (#7) · ก๊วนเฉพาะกิจ hidden series + upgrade + GC ตอนลบนัดสุดท้าย (#12) · ลบก๊วน block-while-sessions + archive (#13) · **preset ถอดทั้ง UI+actions แล้ว (#8; ตาราง `club_presets` รอ CONTRACT)** · fix สำคัญ: ลบนัด repoint คำขอ pending ก่อน CASCADE. ไฟล์แกน: `src/lib/actions/club-series.ts` (guardSeries + 16 actions), `src/lib/club/{open-session,session-defaults,series-permissions,levels-ui,revalidate}.ts`, `src/app/(app)/clubs/[id]/{page,series-home,s/[sid]/*}.tsx`, `src/components/club/series-*.tsx`+`session-defaults-editor`+`create-series-form`+`typed-delete-dialog`. → **(P1)** webhook/บิล/join resolve ผ่าน series + auto-link สมาชิก → **✅ SHIPPED PROD 2026-07-15 (v0.42.0)** — ship-check ครบ (7 findings แก้หมด รวม FK-embed ambiguity ที่เจอจาก live smoke เท่านั้น: ต้อง `club_series!series_id(*)` ไม่งั้น PostgREST ambiguous 2 ทางแล้ว swallow เงียบ) + live browser smoke ผ่าน (auto-link/revoke/generate, net-zero); migration `20260715000400_club_link_requests_series_scope` (เพิ่ม `club_link_requests.series_id` + backfill) **APPLIED prod 2026-07-15**; PR #66→#69 (develop)→#70 (master, deploy READY) (tsc 0 · vitest เขียว · build เขียว). งานที่ทำ: (a) `src/lib/club/series.server.ts` ใหม่ — `getSeriesForClub`/`ensureSeriesForClub` (lazy-attach กติกาเดียวกับ backfill (owner_id,name)) / `resolveLineGroupId`/`resolveJoinToken` (series-first, legacy fallback) / `findSeriesByJoinToken`/`findSeriesByGroupId`/`findGroupBindingConflict` (decision #14 conflict ทั้งสองทิศ) / `upsertSeriesMember` (decision #4/#11, name-only member upgrade path) (b) webhook `handleBind` ผูกที่ `club_series.line_group_id` + error ชัดทั้งสองทิศ, `resolveSelfLink` resolve group→series→active session + upsert `series_members` + stamp `member_id` ทุกครั้งที่ link สำเร็จ (c) `pushGroupBillsAction` resolve ผ่าน series (fallback legacy) (d) `generateClubJoinTokenAction` ย้าย token ไปที่ series (คืน token เดิมถ้ามีแล้ว), `revokeClubJoinTokenAction` เคลียร์ series token (legacy token ของนัดอื่นในก๊วนเดียวกัน**ตั้งใจปล่อยไว้** — join token ไม่ exclusive แบบ LINE group), join page + `requestClubLinkAction` resolve token→series→active session + decision #4 auto-link (ชื่อ roster ตรง exact+unique) + pending idempotent ระดับ series, `linkClubPlayerAction`/`linkKnownProfileAction` upsert `series_members` + stamp `member_id` ก่อน attach, `unlinkClubPlayerAction` เคลียร์ `member_id` (ไม่แตะ `series_members`), `unbindClubLineGroupAction` เคลียร์ทั้ง series **และ** legacy ของทุกนัดในก๊วน (กัน resurrection — จุดเสี่ยงสุดของ cutover นี้) (e) pool UI badge "สมาชิก" ใน `club-link-controls.tsx` (f) pure matcher ใหม่ `src/lib/club/series-member-match.ts` (`classifyMemberNameMatch`, adapter บน `classifyRosterMatch` เดิม) + 6 เทส. i18n: `club.linking.{joinLinkedTitle,joinLinkedDesc,memberBadge,memberBadgeName}` + bot-messages `bindConflictGroup`/`bindConflictSeries` (+ admin editor label) th/en ครบ. `types.ts` เพิ่ม `Club.series_id`/`ClubPlayer.member_id`/`ClubSeries`/`SeriesMember`; public redaction (`toPublicClub`/`toPublicPlayer`) จัดการ field ใหม่แล้ว (series_id ผ่านได้ ไม่ sensitive, member_id null เหมือน profile_id). **ยังไม่ทำ** (นอก scope P1 ตามบรีฟ): site-admin bindings manager repoint, `listLinkableKnownProfilesAction` ยังกรองด้วย `club_id` เดิมไม่ใช่ series-wide → **(P2)** หน้าก๊วนถาวร (สมาชิก/ประวัตินัด/ตั้งค่า/URL ใหม่+redirect) + ปุ่มเปิดนัด (seed ขาประจำ+คู่ประจำ+level) + ถอด preset → **(P3)** ยกของถาวรขึ้น series (promptpay/receipt/co-admins) → **(P4 optional)** สถิติข้ามนัด.
4. **CONTRACT (ทีหลัง, Gate ตาม convention):** drop `clubs.line_group_id`/`join_token` legacy + drop `club_presets` เมื่อทุก path อ่านผ่าน series แล้ว.

**หมายเหตุ:** "เต็มรูป" = commit ทั้ง roadmap ตอนนี้ แต่ engineering ship เป็นเฟส ไม่ทำ mega-PR เดียว (ทุกเฟสผ่าน tsc/vitest/build + e2e ที่เกี่ยว).

### Schema hygiene — verified NOT drop candidates (ตรวจ 2026-07-07)

Fields ที่ audit/grill-me เคย flag เป็น dead-code drop candidate — **ตรวจแล้วยัง LIVE ทั้งหมด, ห้ามลบ** (trace read path + query prod; ตัวเลข+รายละเอียดใน `bug.md` 2026-07-07 + memory `dead-code-audit-false-positives.md`):

- `queue_settings.court_count` — frozen legacy fallback ใน `resolveClubCourts()` (prod **3/8 ก๊วน** มี `clubs.courts` ว่าง → พึ่ง 100%) + ใช้เต็มใน preset flow
- `club_matches.score_a`/`score_b` — display fallback แถวเก่า (prod **1/186** non-null); แถวใหม่ใช้ `games` jsonb
- tournament `matches.team_a_score`/`team_b_score` — denormalized games-won ที่เขียนทุก score record (RPC `record_match_score` + walkover) + อ่าน 8+ จุด — **ไม่ใช่ legacy**

### Roadmap — prioritized next steps (วิเคราะห์ 2026-06-10)

Consolidated จากการ review spec ทั้งฉบับ + `bug.md` (ไม่มี P0/P1 เปิดค้าง — จังหวะดีสุดสำหรับเก็บหนี้เทคนิคก่อนเพิ่ม feature ใหม่).

**Sprint ถัดไป — เก็บหนี้ที่มีเงื่อนเวลา:**

1. ~~**Migration รอบเดียว (#1/#2/#3/M4)**~~ → **✅ ALL DONE** — #1/#2/#3 SHIPPED 2026-06-10; **M4 DROP `team_players.level` ✅ drop แล้ว** (verified 2026-06-26 ผ่าน information_schema — column ไม่มีแล้ว; `club_players.level` + `clubs.shuttle_fee` drop ตั้งแต่ 2026-06-07). ไม่มี pending drop เหลือ — levels FK เป็น source เดียว.
2. ~~**CI pipeline**~~ → **✅ DONE 2026-06-11 (develop)** — `.github/workflows/ci.yml` (job `verify` บน `ubuntu-latest` + Node 22 + npm cache): `npm ci` → `npm run typecheck` (`tsc --noEmit`) → `npm test` (`vitest run`) → `npm run build` (`next build`). Trigger: PR + push เข้า `master`/`develop`; `concurrency` cancel-in-progress ต่อ ref. เพิ่ม script `typecheck` ใน package.json. **Build secret-free** — ทุกหน้าเป็น dynamic (อ่าน env เฉพาะ request, ไม่มี module-level env read) → build step ใส่ placeholder env (Supabase/SESSION ค่าปลอม) ไม่ต้องตั้ง GitHub Secrets; verify ด้วย CI-simulated build (ย้าย `.env.local` ออก + placeholder) ผ่าน 11/11 static pages. local: typecheck 0 err · vitest 511/511.
3. ~~**Repo hygiene**~~ → **✅ DONE 2026-06-10** — (a) 3 throwaway HTML ที่ root ย้ายเข้า `docs/reviews/` แล้วตั้งแต่ 2026-06-09 (`code-review-core-2026-06-09.html`, `phase13-session-summary.html`, `tournament-backlog-T2-T5.html` — tracked); (b) ไฟล์ที่ 4 `session-2026-06-10-status.html` track เพิ่มให้ครบ → review HTML ทั้ง 4 เป็น docs ถาวร (สอดคล้องกับที่ `bug.md` อ้างอิง path เหล่านี้เป็น record); (c) `.codex/` (Codex CLI tooling config) เพิ่มใน `.gitignore` มิเรอร์ pattern `.claude` / `/.agents`

**Feature ลำดับถัดไป (เรียงตาม ROI):**

4. ~~**Club Preset**~~ → **✅ DONE 2026-06-11 (develop, /ship-check PASS — review+simplify+net-zero live-smoke)** — jsonb `club_presets` + 5 actions + UI on `/clubs`; apply = one-shot seed new club. รายละเอียดใน section "ระบบ Preset ก๊วน" ด้านล่าง.
5. ~~**Advance rule "best Nth place" — pair/class mode**~~ → **✅ DONE 2026-06-11 (develop)** — T2 `knockout_fill_byes` ขยายครอบ **class/competition mode** แล้ว (feature #5). รายละเอียดใน T2 entry ด้านล่าง.
6. ~~**Phase 13 polish ชุดเล็ก**~~ → **✅ DONE 2026-06-11 (develop, /ship-check PASS — review+simplify+net-zero live-smoke)** — (a) pair-tab `[ทั้งหมด|…]` class filter (shadcn Tabs) + per-class `X/cap` progress chip (นับ pair ต่อ class จาก `pairs.class_id`, cap จาก `pair_capacity`, " เต็ม" เมื่อ count≥cap) · (b) bracket page (`/tournaments/[id]/bracket`) แยก section ต่อ class (filter `m.class_id`, header สีตาม class, skip class ที่ไม่มี match; sports_day คงเดิม) · (c) class color — helper `classTone(index)`/`classToneById` ใน `src/lib/tournament/class-color.ts` reuse `DIVISION_COLORS` (ไม่เพิ่ม column/migration); แทน hardcoded primary ที่ pair-manager badge + class tab dots (group/knockout) + queue `DivisionBadge`. index→tone มาจาก `position` order เดียวกันทุกจุด → สีตรงกัน. tsc 0 · vitest 475/475

**ระยะกลาง:**

7. **i18n TH/EN** — ~~ตัดสินใจ go/no-go ให้ชัด~~ → **COMPLETE ✅ 2026-06-12 — SHIPPED master** (merge `c05ba04`, /ship-check ผ่าน). next-intl แบบ cookie-based (ไม่มี URL routing, mirror `theme` cookie) ครอบทั้ง app: components + pages + server-action error/toast strings ครบ. locale switcher (TH⇄EN) อยู่ใน account dropdown. architecture ใน `CLAUDE.md > ## Internationalization (i18n)`; รายละเอียดใน UX polish backlog ด้านล่าง
8. ~~**Club queue Realtime**~~ → **✅ DONE 2026-06-15 (develop)** — หน้าก๊วน subscribe Realtime **Broadcast** (ไม่ใช่ postgres_changes — `club_matches`/`club_players` ถูกล็อกจาก anon เพื่อกัน PII ตั้งแต่ 2026-06-14 จึงเปิด anon SELECT ไม่ได้). migration `20260615000100`: trigger `club_queue_broadcast` (SECURITY DEFINER, `search_path=''`) ยิง `realtime.send(payload={club_id,table}, 'change', 'club:<id>', private=false)` บน INSERT/UPDATE/DELETE ของ `club_matches`+`club_players` → public topic, payload signal-only (ไม่มี row data/PII). `ClubLiveWrapper` (`src/components/club/club-live-wrapper.tsx`, mirror `TournamentLiveWrapper`) subscribe public topic `club:<id>` → debounce 800ms `router.refresh()`; ข้อมูลจริง re-fetch ผ่าน service-role (ไม่เปิด anon read บนตารางก๊วน). flag `queue_settings.realtime_enabled` (default true) + toggle ใน `club-queue-settings.tsx`. **Live-verified net-zero (ครบ 3 ชั้น):** (1) transport — anon publishable-key subscriber รับ public broadcast 2/2; (2) trigger — `realtime.messages` มี row ครบ (INSERT match + UPDATE×3 + seed players) + anon รับสด 3/3; (3) **browser smoke** — Playwright เปิดหน้าก๊วนจริง (owner cookie) → "รอแข่ง 0→1" auto-refresh ไม่ reload หลัง INSERT match. UI no longer shows a LIVE badge as of 2026-07-05. รายละเอียดใน `bug.md`.
9. ~~**Security follow-ups**~~ → **✅ ALL DONE** — ~~session revocation~~ ✅ DONE 2026-06-10 (M3 — ดู "Migration batch 2026-06-10"); ~~RPC grant hardening~~ ✅ APPLIED 2026-06-10 (`20260610000400`); ~~guest-profile rate limit~~ ✅ **MOOT 2026-06-24** — guest signup ถอดออก v0.14.0 แล้ว ไม่มี guest-profile creation path ให้ rate-limit
10. **Prize summary + Wheelspin** — ~~**Prize summary**~~ → **✅ DONE 2026-06-17 (develop, /ship-check PASS)** — หน้า `/tournaments/[id]/prizes` สรุปแชมป์/รองแชมป์/รองอันดับ อัตโนมัติจากสาย KO ต่อ class/division + เจ้าของตั้ง `prize_template` (อันดับ/ป้าย/เงินรางวัล/ถ้วย) ได้. รายละเอียดใน section "Prize summary" ด้านล่าง. **Wheelspin (วงล้อสุ่ม) — ยังค้าง** (deferred: pool เลือกได้ + เด้งขึ้นจอ TV)
11. **Custom ใบเสร็จเรียกเก็บเงิน (club)** — ✅ **v1 DONE 2026-06-25 (v0.15.0, SHIPPED master) · v2 ธีมสี DONE 2026-06-26 (v0.16.0, SHIPPED master)** — ให้เจ้าของก๊วน custom ใบเสร็จที่ใช้เรียกเก็บเงินเองได้. ปัจจุบันใบเสร็จเป็น layout ตายตัวใน `club-slip-card.tsx` (`SlipCard`/`buildSlipMeta`) + `PlayerReceipt` ใน `club-payment-collector.tsx` — ดึงจาก `computeClubCostRows` + PromptPay config. **ขอบเขตยังต้อง clarify**: custom อะไรได้บ้าง — หัวบิล/ชื่อก๊วน, ข้อความท้ายบิล (เช่น "ขอบคุณที่มาเล่น"), โลโก้/รูป, เลือกฟิลด์ที่โชว์ (ซ่อนค่าคอร์ท/ลูก/ส่วนลด), สี/ธีม? **v1 shipped:** `clubs.receipt_template jsonb` + `receipt_logo_url` (migration `20260625000100` — ✅ **applied remote 2026-06-25** หลัง user อนุมัติ; verified ผ่าน information_schema) · `src/lib/club/receipt.ts` (zod schema + tolerant parser mirror `parseSettings`; 16 unit tests) · 3 actions ใน `club-payments.ts` (`updateClubReceiptTemplateAction` / `uploadClubReceiptLogoAction` / `removeClubReceiptLogoAction` — `assertCanManageClub`, full-replace, logo bucket `club-qr` path `{clubId}/receipt-logo`) · `receipt-template-editor.tsx` (TanStack Form + live `SlipCard` preview) mount ในแท็บค่าใช้จ่าย. ครอบ: footer free-text · toggle court/shuttle/expense/discount (total เสมอ) · โลโก้ก๊วนแทน 🏸 · เลือกช่องทาง promptpay/bank. Config derive จาก `club.receipt_template` ใน **ทั้ง** PNG `SlipCard` + on-screen `PlayerReceipt`. `toPublicClub` redact receipt fields (กันเลขบัญชีรั่ว). **v2 ธีมสี DONE 2026-06-26 (v0.16.0):** picker 6-สี palette ในเอดิเตอร์ (`RECEIPT_THEMES`) + `resolveReceiptTheme` wire เข้า header band + total ของ `SlipCard` และ total ของ on-screen `PlayerReceipt`; live preview สะท้อน. **เหลือเฉพาะ #12 v2 (bank credit-transfer QR).**
12. **รับเงินด้วยเลขบัญชีธนาคาร (club)** — ✅ **v1 (ทางเลือก a — โชว์เลขบัญชีเป็นข้อความ) DONE 2026-06-25 (v0.15.0, SHIPPED master)** | v2 (ทางเลือก b — credit-transfer QR) ค้าง — รวมเข้ากับ #11 (`receipt_template.bank` + `payment_show.bank`): `clubs.promptpay_id` + `src/lib/club/promptpay.ts` (`detectPromptPayType`/`buildPromptPayPayload`) รองรับเฉพาะ **mobile(10)/national_id(13)/ewallet(15)** — เพิ่ม option ให้เจ้าของใส่ **เลขบัญชีธนาคาร** (ธนาคาร + เลขบัญชี + ชื่อบัญชี).
    - **ทางเลือก a (ง่าย/ปลอดภัยสุด) ✅ as-built:** โชว์ ธนาคาร+เลขบัญชี+ชื่อ เป็น**ข้อความ**บนใบเสร็จ (ไม่มี QR ฝังยอด — payer โอนเอง). **เก็บใน `receipt_template.bank {name,account_no,account_name}` jsonb (ไม่ใช่ column แยก ตามที่ design เดิมคิดไว้)** + toggle `payment_show.{promptpay,bank}` ในการ์ด "ปรับแต่งใบเสร็จ"; render bank block ทั้ง PNG `SlipCard` + on-screen `PlayerReceipt` เมื่อ `payment_show.bank` + `hasBankReceiver`.
    - **ทางเลือก b (มี QR — research 2026-06-24):** **ทำได้จริง** — Thai QR มี proxy แบบ **"PROMPTPAY_CREDIT_TRANSFER"** = Tag **29** + **AID เดียวกับ PromptPay** (`A000000677010111`) แต่ value = **รหัสธนาคาร BOT 3 หลัก + เลขบัญชี** (เช่น `014` SCB + เลขบัญชี); **ฝังยอดได้** (dynamic QR). parser มาตรฐานรู้จัก field `BankAccount`/`OTA`. **อย่า hand-roll** — sub-tag/format ของ proxy นี้ยังไม่ยืนยันจาก primary source และถ้า byte ผิด = เงินเข้าผิดบัญชี → **ใช้ library ที่ใช้จริง**: `promptpay-js` (`generate({application:'PROMPTPAY_CREDIT_TRANSFER', bankAccount:'014...', amount})`) หรือ `promptparse`/`thai-qr-payment`. ต้องมี mapping รหัสธนาคาร BOT 3 หลัก.
    - **⚠️ ความเสี่ยงหลักของ b — compatibility:** PromptPay (เบอร์/บัตร) สแกนได้ทุกแอปธนาคารแน่นอน แต่ **bank-account credit-transfer QR ยังไม่การันตีว่าทุกแอป mobile banking สแกนได้** → ต้อง **เทสกับแอปจริง 2-3 ธนาคารหลัก** ก่อน ship. ทุก QR ต้องสแกนผ่าน **แอป mobile banking เท่านั้น** (ไม่ใช่ QR scanner ทั่วไป — เหมือน PromptPay เดิม).
    - **คำแนะนำ:** ก๊วนทั่วไป a พอแล้ว (โชว์เลขบัญชี); ทำ b เมื่อ user ยอมรับภาระเทส compat + ต้องการความสะดวกฝังยอด. ถาม user ก่อนเริ่มว่าเอา a หรือ b.

**Gaps ที่ระบุเพิ่มจาก review 2026-06-10 (ไม่เคยอยู่ใน spec):**

- ~~**ไม่มี E2E suite ถาวร**~~ → **✅ DONE 2026-06-23** — `@playwright/test` suite ใน `e2e/` (rerun ได้, `npm run e2e`). **net-zero against prod** (DB เดียว): `global-setup` seed throwaway club (marker `SMOKE_E2E_` + fixed UUID) + mint `bc_session` cookie จาก `SESSION_SECRET` (env) → storageState; `global-teardown` ลบทิ้ง 0 row. `e2e/club-flow.spec.ts` (serial, 5 tests): auth → **A1** ปุ่ม "ทุกสนาม" สร้าง 2 แมตช์ → start → **A4** backdate started_at → badge "เกินเวลา" → จบแมตช์ → cost tab. helpers `env`/`auth`(mint mirror session.ts)/`db`(service-role seed/teardown)/`fixtures`. **local-only — ไม่เข้า CI** (CI ยิง prod = ไม่ดี; ตัดสินใจ 2026-06-23). `e2e/` ถูก exclude จาก tsconfig (Playwright transpile เอง). gate: tsc 0 · vitest 729/729 · **e2e 5/5 PASS** · net-zero verified.
- **T5 realtime — ✅ core verified 2026-06-15 (live, net-zero):** seed throwaway team tournament + 1 in_progress match + `realtime_enabled:true` + `queue_payload_sync:true` → เปิด admin queue tab (realtime subscribed) → UPDATE match→completed ผ่าน SQL (จำลอง client อื่น) → **page1 เปลี่ยนเอง ไม่ reload** (กำลังแข่ง 1→0, จบแล้ว 0→1) ผ่าน realtime subscription. **Race-hardening ✅ DONE 2026-07-04** (`e2e/race-hardening.spec.ts` + `e2e/helpers/tournament-fixtures.ts`, net-zero, 10/10 PASS): deterministic races 5 ชุด — **R5** 2 live tabs mid-drag vs server reorder → ทุกจอ+DB converge (I5; warm-up gate + รันก่อน DB rounds กัน WAL backlog) · **R1** reorder∥reorder ×20 → advisory lock serialize ไม่มี interleave (I1+I2) · **R3** start∥start สนามเดียว ×20 → unique index กัน 20/20 (I3) · **R4** start∥start แมตช์เดียว ×20 → เริ่มได้ครั้งเดียว (I4) · **R2** เดิมเป็น known-gap probe พบ P2: reorder ชน start → แมตช์ in_progress ถูก renumber 26/30 — **✅ RESOLVED 2026-07-06**: fix `20260704000200_swap_pending_lock_rows_before_validate` (`FOR UPDATE` rows ก่อน validate) **applied prod + verified**; R2 อัปเกรดเป็น hard invariant **I6** (snapshot เลขตอน `start` return ต้องเท่ากับเลขสุดท้าย — แมตช์ที่เริ่มแล้วห้ามถูก renumber) ผล `midGameRenumber=0/30`, suite 5/5 PASS (v0.18.1 — ดู bug.md dated 2026-07-06). **โบนัส 🔴 P1 FOUND+FIXED:** `tournaments` หายจาก publication `supabase_realtime` → channel ระดับหน้าเงียบทั้งตัว = `TournamentLiveWrapper` refresh ไม่เคยยิงเลยทุกหน้า — fix `20260704000100_add_tournaments_to_realtime_publication` ✅ applied prod + verified (v0.16.3)
- ~~**`clubs.ts` โตเกินขนาด**~~ → **✅ DONE 2026-06-11 (develop)** — แตก `clubs.ts` (1692→329 บรรทัด, −80%) เป็น: `club-players.ts` (9 actions) · `club-matches.ts` (11) · `club-cost.ts` (5) · `club-admins.ts` (3) · `levels.ts` (4, global level CRUD) — clubs.ts เหลือ 7 club-core actions. Shared helper (`loginRedirect`/`assertCanManageClub`/`assertClubOwner`) ย้ายไป **`src/lib/club/permissions.ts`** (plain module, ไม่ใช่ `"use server"` — mirror `tournament/permissions.ts`); helper เฉพาะกลุ่ม (`loadClubMatchForManage`/`validClubPayerIds`/`promoteReservesToFill`/`countClubPlayers`) คงเป็น internal ในไฟล์ที่ใช้. แต่ละ action file เป็น `"use server"` (export แค่ async fn + type; zod schema คง internal const). อัปเดต 18 import sites (รวม tournament pages ที่ใช้ `getLevelsAction`). Pure move ไม่แตะ logic — 39 actions ครบ (39=39). tsc 0 · vitest 511/511 · build เขียว.
- **T2 team-mode KO + BYE — ✅ verified 2026-06-15 (live, net-zero):** seed throwaway team tournament (knockout_only, 3 ทีม) → กด "สร้างสาย" ใน UI → bracket of 4 + 1 BYE: seed 1 (TeamA) ได้ BYE → match **completed อัตโนมัติ winner=TeamA** advance ไปชิงชนะเลิศ; TeamB vs TeamC = แมตช์จริง pending. UI render "BYE — ผ่านโดยอัตโนมัติ" ถูก, 0 console error. team-mode generation path (UI→generateKnockout→DB) ทำงานครบ

### Prize summary (สรุปรางวัล) — ✅ DONE 2026-06-17 (develop, /ship-check PASS)

หน้าสรุปรางวัลพิมพ์ได้ `/tournaments/[id]/prizes` (server component, `force-dynamic`) — คำนวณผู้ชนะอัตโนมัติจากสาย KO แล้วซ้อนด้วย template ที่เจ้าของตั้งเอง.

- **Logic — `src/lib/tournament/prizes.ts`** (pure, 9 vitest):
  - `computePrizeResult(matches, competitorMap)` → `{ champion, runnerUp, semifinalists[], finalDecided, hasBracket }`. **Final** = แมตช์สุดท้าย (`next_match_id===null` ใน `upper` หรือ `grand_final`; round_number สูงสุดชนะเมื่อมีหลายตัว). **Champion** = `winner_id`; **runner-up** = ฝั่งแพ้ในไฟนอล; **semifinalists** = ฝ่ายแพ้ของทุกแมตช์ที่ feed ไฟนอล (`next_match_id===final.id`) แบบ dedupe. กัน double-elim ซ้ำด้วยการ seed `seen` ด้วย id แชมป์+รองแชมป์ก่อน (grand-final loser = รองแชมป์ จะไม่ถูกนับเป็น semifinalist ซ้ำ). BYE (ฝั่ง null) ไม่เพิ่มใคร. รองรับทั้ง pair-mode (`pair_a_id`) และ team-mode (`team_a_id`).
  - `parsePrizeTemplate(raw)` — parse jsonb แบบ tolerant (ทิ้ง entry เพี้ยน), **dedupe rank (เก็บตัวแรก)** เพื่อให้ consumer key ตาม rank ได้ปลอดภัย, sort rank ASC.
  - `PrizeTemplateSchema` = array(max 20) ของ `{ rank int 1-99, label 1-60 ตัวอักษร, cash int 0-1e8 default 0, trophy bool default false }`.
- **Scope grouping** (ในหน้า): competition + มี class → ต่อ `class_id`; ไม่ใช่ + มี `pair_division_thresholds` → ต่อ division; นอกนั้น = bucket เดียว "ทั้งหมด". แต่ละ scope คำนวณ result + วาดตารางแยก (สี accent ตาม class/division).
- **Column** — `tournaments.prize_template jsonb NOT NULL default '[]'` (migration `20260617000100_add_tournament_prize_template`, idempotent `IF NOT EXISTS`; **live บน prod แล้ว** — apply ผ่าน MCP ตอน build). ไม่อยู่ใน `settings` (mirror `courts`).
- **Editor** — `src/components/tournament/prize-template-editor.tsx` (client, owner/co-admin เท่านั้น) → `updatePrizeTemplateAction(tournamentId, template)` ใน `tournaments.ts` (mirror `updateCourtsAction`: `assertCanEdit` + zod + sort + audit `prize_template_updated` + revalidate). เมื่อไม่มี template → ตารางใช้ default rows (ชนะเลิศ/รองชนะเลิศ/รองอันดับ) auto.
- **UI** — shadcn `Table` + `<Link>` ไป stats page ของผู้ชนะ; `PrintButton` + controls ซ่อนตอนพิมพ์ (`print:hidden`); ลิงก์เข้าจากหน้า detail (ปุ่มในแถบ).
- **i18n** — `tournament.prizes.*` (24 keys th/en parity) + `actions.tournament.savePrizeTemplateFailed`.
- **Smoke (net-zero, dev :3000, owner cookie)**: seed pair tournament + สาย single-elim 3 แมตช์ → `/prizes` HTTP 200, แชมป์/รองแชมป์/รองอันดับ 2 render ลำดับถูก, ตารางขึ้น, editor เห็นเฉพาะ owner (anon เห็นแต่ตาราง), 0 error → teardown 0 row.

### Migration batch 2026-06-10 — ✅ #1/#2/#3 shipped (develop; M1–M3 applied to prod)

tsc 0 · vitest **470/470** · introspect-verified pre/post apply (per-column + pg_proc + RLS). รายละเอียด resolved entries ใน `bug.md`.

- **M1 `apply_group_team_delta`** (migration `20260610000100`, applied): atomic `col = GREATEST(0, col + delta)` ต่อ row — `matches.ts` `updateGroupTeamStandings`/`reverseGroupTeamStandings` dedup เป็น `applyGroupTeamStandings(sign: 1|-1)` เรียก RPC; ปิด lost-update race ตอนบันทึกผล 2 แมตช์ในกลุ่มเดียวกันพร้อมกัน. Forward path floor เป็น no-op (delta ≥ 0), reverse ตรง `Math.max(0,…)` เดิม.
- **M2 `add_club_player`** (migration `20260610000200`, applied): นับ active + ตัดสิน `active|reserve` + INSERT ใต้ `clubs` row `FOR UPDATE` ใน transaction เดียว — `clubs.ts` `addGuestPlayerAction` เรียก RPC แทน read-then-insert; ปิด capacity overshoot race. `position = total+1` ตาม behavior เดิม.
- **M3 session revocation** (migration `20260610000300`, applied; 11/11 profiles sv=0): `profiles.session_version int NOT NULL DEFAULT 0` + RPC `bump_session_version`. Code: ดูบรรทัด Auth ใน `### Stack` (sv stamp + `React.cache()`'d `getSession` + `/api/auth/logout-all` + ปุ่ม 2 จุด).
- **Bundled — dead `level` refs removed**: `types.ts` `TeamPlayer.level` ลบทิ้ง (+ optional `levels?` embed); `/tournaments/[id]/page.tsx` + print roster + `csv.ts` `generateRosterCsv` อ่าน level ผ่าน `embeddedReal(p.levels)` (embed `levels:level_id(real)`). = prerequisite ฝั่ง code ของ M4.
- **M4 ✅ APPLIED 2026-06-10** (migration `20260610000500`, Gate-4 user-confirmed): `ALTER TABLE team_players DROP COLUMN IF EXISTS level`. Applied via MCP **หลัง** develop→master deploy (commit `60970c9`) verified **READY** บน prod (poll Vercel deployment จน readyState=READY) เพื่อให้ prod code ใหม่ (level_id path) serve ก่อน column หาย. Verify หลัง drop: 0 `level` columns เหลือ · `level_id` คงอยู่ · 72/72 players มี level_id (ไม่มีข้อมูลหาย) · prod public `/t/[token]` (select `team_players(*)`) + homepage = HTTP 200. Introspect 2026-06-10: `club_players.level` + `clubs.shuttle_fee` ถูก DROP ไปแล้ว 2026-06-07. **ปิด EXPAND/contract drop ตัวสุดท้าย — ไม่มี legacy level/shuttle_fee column เหลือที่ไหนแล้ว.**
  - **Bonus live-smoke (2026-06-10, net-zero throwaway club):** club cost/dashboard batch (4 commit ที่ยังไม่ live-smoke ก่อน merge — 97a285a/66793e8/3876158/3b2f09e) ผ่านครบ — dashboard render + cost reconcile (court 602 + shuttle 100 = header 702, 0 console error), cost tab column ใหม่ (ชม./ลูกที่ใช้/ค่าสนาม/ค่าลูก/ส่วนลด/รวมทั้งหมด) + ปุ่ม Export CSV, **reserve drag-promote (dnd-kit) → DB flip reserve→active จริง** (ต้องใช้ manual pointer sequence ผ่าน 8px activation — `dragTo`/HTML5-drag ไม่ trigger PointerSensor), delete-club dialog type-name confirm (ปุ่ม disabled จนชื่อตรง) → CASCADE → redirect. throwaway club + guest profile ลบหมด, NOMKONZ 2 clubs เดิมไม่ถูกแตะ. M3 encode path verified ในตัว (fresh login cookie มี `sv:0`).
- **Hardening — ✅ APPLIED 2026-06-10 (user-approved)**: grant audit หลัง apply พบ RPC 8 ตัว (เก่า 5 + ใหม่ 3) มี anon/authenticated EXECUTE จาก Supabase default privileges — ยังไม่ exploitable (ทุกตารางที่แตะ RLS-on + SELECT-only policies) แต่ผิด invariant "service_role only". Migration `20260610000400_revoke_rpc_execute_anon` applied; verify แล้วทั้ง 8 เหลือ `postgres + service_role`. **Convention ใหม่สำหรับ RPC migration ทุกตัวต่อจากนี้: ต้อง `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` เสมอ** (`REVOKE FROM PUBLIC` อย่างเดียวไม่พอ — ไม่ strip role-specific default grants).
- **Club RLS lockdown — 🔴 P0 SECURITY FIX ✅ APPLIED 2026-06-14** (migration `20260614000100_fix_club_rls_anon_exposure`; พบโดย whole-system club code-review — รายละเอียดใน `bug.md`): ตารางก๊วนเคยเปิดให้ role `anon` ผ่าน PostgREST. `club_admins`/`club_expenses` มี policy `FOR ALL TO public USING(true) WITH CHECK(true)` (ลืม `TO service_role`) → **anon เขียนได้** (self-grant co-admin / ปลอมค่าใช้จ่าย); ทุกตารางก๊วน + `profiles` มี `*_read_all` SELECT `USING(true)` → **anon อ่านได้** (ก๊วน private, line_user_id PII). Fix = DROP 2 write-policy + DROP 6 read-all policy + REVOKE anon/authenticated DML บน 7 ตารางก๊วน. **Invariant ใหม่: ตารางก๊วนไม่มี policy ใดๆ (RLS-on no-policy = service-role-only) — ห้ามเพิ่ม read-all/ALL policy ให้ public อีก**; app อ่าน/เขียนผ่าน `createAdminClient` (service-role) ล้วน. anon browser client ใช้แค่ Realtime ฝั่งทัวร์ฯ (`matches`/`tournaments` คงไว้). **Tournament RLS lockdown — ✅ APPLIED 2026-06-14** (migration `20260614000300_lock_tournament_tables_from_anon`): ล็อก 6 ตารางทัวร์ฯ ที่ไม่มี Realtime (`teams`/`team_players`/`pairs`/`groups`/`group_teams`/`tournament_classes` — drop read-all + revoke anon/auth DML; ปิด PII ชื่อผู้เล่น + structure). `matches`/`tournaments` **คง anon SELECT** (Realtime `postgres_changes` ต้องใช้ — รวม admin live-view ทัวร์ฯ ที่ยังไม่ share) แต่ revoke write grant. **Invariant: ตารางทัวร์ฯ นอกจาก matches/tournaments ไม่มี policy ใดๆ (service-role-only); matches/tournaments มีแค่ SELECT-read-all.** Residual ยอมรับ: anon อ่าน metadata ทัวร์ฯ + สกอร์ได้ (Realtime constraint — scope `share_token` ได้แต่จะทำ live-view ทัวร์ฯ private พัง).
- **Smoke ที่ต้องทำบน preview ก่อน merge master**: auth round-trip (login เดิมไม่หลุด — cookie ไม่มี `sv` ต้องยังใช้ได้, login ใหม่ได้ `sv`, ปุ่ม "ออกทุกอุปกรณ์" เด้งทุก session ของ profile นั้น), เพิ่มผู้เล่น guest ผ่าน RPC ใหม่, บันทึก/รีเซ็ตผลแมตช์กลุ่ม (standings ขยับถูกผ่าน RPC ใหม่).

### ระบบก๊วน (Club session) — create form + rotation queue + cost split  [✅ DONE — rotation queue + cost (court/shuttle/per_match) + locked pairs + manual match; canonical summary in `## Club System`]

ก๊วนแบดแบบเล่นสนุก (casual session) — แยกจาก tournament. ตอนสร้างก๊วนมีฟอร์มตั้งค่า + ระบบหมุนคิว + หารค่าใช้จ่าย. ตั้งค่าทุกตัวแก้ได้ภายหลังในหน้า settings ของก๊วน.

#### Part A foundation — ✅ IMPLEMENTED (2026-06-06, develop)

**Shipped:** migration `20260606000300_club_rotation_queue` — `clubs +queue_settings jsonb` · `club_players +last_finished_at timestamptz` · ตารางใหม่ `club_matches` (id · club_id FK CASCADE · court int · **side_a_player1/2 + side_b_player1/2** = 4 nullable FK → club_players ON DELETE CASCADE, player2 null = singles · status pending/in_progress/completed/cancelled · queue_position · winner_side a/b · score_a/b · started_at · ended_at) + partial unique `uniq_club_matches_inprogress_court (club_id,court) WHERE status='in_progress'` + indexes (club_id,status)/(club_id,queue_position)/4×FK + RLS read-all SELECT. `src/lib/club/queue-settings.ts` (`ClubQueueSettingsSchema` zod + `parseQueueSettings()` per-field fallback, mirror tournament `settings.ts`) · `src/lib/club/queue.ts` pure `buildNextMatch(pool, settings, stayingSide?)` (19 vitest) · `Club.queue_settings` + `ClubPlayer.last_finished_at` + `ClubMatch`/`ClubMatchStatus` types. tsc clean · vitest 383 · prod build pending.

> **Schema decision:** match sides = 4 FK columns (NOT `uuid[]`) — keeps FK/cascade integrity + per-player queries + matches tournament `pair_a_id`/`team_a_id` idiom (advisor-flagged). config = jsonb (extensible without DDL). `games_played` source-of-truth: **auto-incremented from completed `club_matches`** once rotation is used; manual entry = pre-queue fallback.

**Pure algorithm `buildNextMatch(pool, settings, stayingSide?)`** (`queue.ts`): pool = checked-in & not-currently-playing players. Ordering by `queue_mode`: `rest_longest`/`level_match` (last_finished_at asc, null=front → games_played → intake-order tiebreak `cmpIntakeOrder`: position→joined_at→id), `level_match` (anchor = most-rested, fill nearest-level). `fifo` removed v0.25.0 (folded to rest_longest on parse; `cmpFifo` kept internally as `cmpIntakeOrder` tiebreak only). Split into sides: `skill_level_enabled` → greedy level-balance; else pick-order. `winner_stays` → caller passes `stayingSide` (sideA kept, opponents drawn from pool); `winner_stays_max` streak cap enforced in action layer. Returns null when pool < 2×players_per_team. **level_match = rest_longest ordering + level-balanced split** (legacy `smart` folded into `level_match` 2026-07-07 — was byte-identical; `parseQueueSettings`/`parsePresetConfig` translate stored `smart`→`level_match`).

#### Part A actions + UI — ✅ IMPLEMENTED (2026-06-07, develop)

**Server actions** (`clubs.ts`, owner/co-admin via `assertCanManageClub`): `updateClubQueueSettingsAction(clubId, patch)` (parse→shallow-merge→re-validate jsonb), `buildNextClubMatchAction(clubId, court)` (pool = checked-in & not-in-active-match; check-in gate only when ≥1 checked in; winner_stays staying-side via consecutive-win streak vs `winner_stays_max`; inserts pending row w/ queue_position tail), `startClubMatchAction(matchId)` (pending→in_progress; court-occupancy 23505 → friendly error), `finishClubMatchAction({matchId, winnerSide?, scoreA?, scoreB?})` (via RPC `finish_club_match` — atomic complete + bump games_played/last_finished_at, idempotent), `cancelClubMatchAction(matchId)` (→cancelled). RPC migration `20260607000100_club_finish_match_rpc` (SECURITY INVOKER, service_role grant, FOR UPDATE row-lock).

**UI:** `club-queue-settings.tsx` (owner/co-admin card, 7 fields + winner_stays_max conditional, 500ms debounce + unmount-flush, mirror `settings-manager.tsx`) · `club-queue-panel.tsx` (Tabs รอแข่ง/กำลังแข่ง/จบแล้ว + count badges; per-court "สร้างแมตช์ถัดไป"; per-row เริ่ม/ยกเลิก/จบแข่ง→winner picker; `ElapsedTicker` mm:ss; `text-winner` highlight; useTransition + toast + router.refresh). Wired in `clubs/[id]/page.tsx` (matches fetch added to parallel block, `queueSettings = parseQueueSettings`, settings gated canManage, panel for all). tsc clean · vitest 383 · build OK.

> create-form 7 fields **not added** — settings เป็น edit-later บนหน้า club detail (ตรง spec "แก้ได้ภายหลัง"); create ใช้ default จาก `queue_settings '{}'`.
>
> **A2 — score entry 3 โหมด ✅ DONE (static-green, 2026-06-08, develop):** finish region ใน `club-queue-panel.tsx` (InProgressRow) มี 3 ทาง — (1) **กรอก score `a:b` เต็ม** (2 `Input` number 0–99 + ปุ่ม "บันทึกผล"; block คะแนนเท่า "ต้องมีผู้ชนะ"; winner derive ฝั่ง server) · (2) **กดฝั่งผู้ชนะ** (ปุ่ม A/B ชนะ, ไม่บันทึกคะแนน) · (3) **จบแบบไม่ระบุผล** (no winner/score). ทั้ง 3 ทาง RPC `finish_club_match` → `games_played++` + คืนสนาม. Winner derive ผ่าน pure `deriveWinnerSide(a,b)` (`queue.ts`, equal→null, +3 vitest) เรียกใน `finishClubMatchAction` เมื่อมี score แต่ไม่มี winnerSide. `CompletedRow` โชว์ `score_a : score_b` (tabular-nums) + winner highlight + trophy. tsc clean · vitest 28 (club queue). **✅ live-smoke PASS 2026-06-15 (A6 capstone) — ดูด้านล่าง.**
>
> **A backlog — ปิดครบแล้ว:** ~~auto-rotate-all-courts (A1)~~ → **✅ DONE 2026-06-23** (`buildAllCourtsAction` + ปุ่ม "ทุกสนาม" — สร้างแมตช์ถัดไปให้ทุกสนามว่าง [ไม่มี pending/in_progress] พร้อมกัน, loop per-court builder + break เมื่อผู้เล่นหมด). ~~not_ready_action wiring (A3)~~ → **✅ DONE 2026-06-22** (ใช้เช็คอินเป็นตัวบอกความพร้อม: `skip`=ตัดคนยังไม่เช็คอินออก [default = พฤติกรรมเดิม] / `requeue`=ดึงได้แต่ต่อท้ายคิว ผ่าน `QueuePlayer.notReady` ready-first ordering; มีผลเมื่อมีคนเช็คอินแล้ว ≥1 คน). ~~game_time_limit enforcement (A4)~~ → **✅ DONE 2026-06-23** (over-time indicator ใน `ElapsedTicker`: timer แดง + badge "เกินเวลา" เมื่อ elapsed > `game_time_limit_min`; ไม่บังคับจบ — เป็นสัญญาณเตือน referee). ~~Realtime (A5)~~ → **✅ A5 DONE 2026-06-15** (Broadcast-from-DB; ดู roadmap #8 ด้านบน).
>
> **A6 capstone — ✅ live-smoke PASS 2026-06-15 (net-zero, Playwright, owner cookie):** ขับ club queue path เต็มเส้นใน browser จริง — build (ต่อสนาม) → start (court-occupancy index ผ่าน) → finish (3-mode, ทดสอบปุ่มฝั่งชนะ) → `games_played++` + `last_finished_at` + `winner_side` บันทึกถูกทุกครั้ง. **winner_stays + winner_stays_max=2 ยืนยันสด:** 2 สนาม/8 คน — ผู้ชนะอยู่ต่อเกม 2 (stayingSide ถูกส่ง), ชนะติด 2 → build เกม 3 ถูก **บังคับออก** (cap), คนพักนานสุด (เกมน้อยกว่า) ได้ลงแทน. **เคสคนเกินขั้นต่ำ:** 1 สนาม/6 คน → ลง 4 รอ 2, เกม 2 คนรอ (พักนานสุด, never-played) ได้ลงแทนผู้แพ้; 2 สนาม/12 คน → ลง 8 (P1-P8) รอ 4 (P9-P12). cost tab render + reconcile (ค่าสนาม+ลูก). console 0 error ทุกหน้า · seed throwaway ลบหมด net-zero. **Minor (P2, log):** ปุ่ม เริ่ม/ยกเลิก ใน pending row เป็น icon-only ไม่มี `aria-label` (ควรเพิ่มตาม tooltip convention — ไม่บล็อก).

#### ล็อคคู่ (locked teammate pairs) — ✅ IMPLEMENTED (2026-06-07, develop)

บังคับ 2 คนเป็นคู่เดียวกัน (teammate, same side) ตอน queue จัดแมตช์ doubles. **Decisions:** teammate (ฝั่งเดียวกัน) + **strict** (คู่ไม่ว่าง → A รอ ไม่จับคนอื่น).
- **DB** migration `20260607000200_club_locked_pairs`: ตาราง `club_locked_pairs` (player1_id/player2_id FK club_players CASCADE, `games_remaining int null` — null=ตลอด, N=ล็อค N เกมที่เล่นด้วยกัน แล้วปล่อยอัตโนมัติ; CHECK distinct + games≥0; RLS read-all). RPC `finish_club_match` extended: ลด `games_remaining` ของล็อคที่ทั้งคู่เล่นในแมตช์นั้น + DELETE เมื่อ ≤0 (atomic).
- **queue.ts** `buildNextMatch(pool, settings, stayingSide?, lockedPairs?)`: doubles + locks → locked pair = 1 ฝั่งเต็ม; strict filter (locked member ที่ partner ไม่อยู่ pool ถูกตัดออก = รอ); `takeSides()` greedy assemble (locked pair / 2 frees per side). singles ignore locks. skill-balance ถูกข้ามเมื่อมี lock active. +6 vitest.
- **Actions** (clubs.ts): `createClubLockedPairAction({clubId, player1Id, player2Id, games?})` (1-active-lock-per-player guard via OR-query) · `releaseClubLockedPairAction(lockId)`. `buildNextClubMatchAction` โหลด `club_locked_pairs` ส่งเข้า `buildNextMatch`.
- **UI** `club-locked-pairs.tsx`: create form (2 player Selects + ตลอด/N-เกม toggle) + active-lock list (ตลอด / เหลือ N เกม + ปุ่มปล่อย); **collapsible** — กด CardHeader ยุบ/ขยายทั้งการ์ด (form + list) ผ่าน `Collapsible`, **default ยุบ** (flip 2026-06-18), header โชว์จำนวน lock `(N)` + chevron หมุน; wired ใน `clubs/[id]/page.tsx` gated `players_per_team === 2`. `ClubLockedPair` type. tsc 0 · vitest 389 · build OK.

#### Confirm dialog ลบผู้เล่น — ✅ IMPLEMENTED (2026-06-07, develop)

`kick-button.tsx` เปลี่ยนจากลบทันที → Dialog (Base UI `@base-ui/react/dialog`) ยืนยันพร้อมอธิบายผลกระทบก่อนเรียก `kickPlayerAction`: แมตช์ที่ผู้เล่นอยู่ (รอ/กำลังแข่ง/จบ) ถูกลบตาม CASCADE · คู่ที่ล็อคถูกปล่อย · ถอดออกจากการหารค่าใช้จ่าย · "ลบถาวร". รับ prop `playerName` แสดงในหัว dialog (ส่งจาก `SortablePlayerList`).

#### ค่าลูกต่อแมตช์ (per-match shuttle) — ✅ IMPLEMENTED (2026-06-07, develop)

shuttle_split mode ที่ 3 = `per_match` (เพิ่มข้าง even/by_games ไม่แทน). migration `20260607000300`: `clubs.shuttle_price numeric` (ราคา/ลูก) + `club_matches.shuttles_used int default 1` (CHECK ≥0). cost-split: `SplitInput` รับ `shuttlePrice?` + `matches?: SplitMatch[]`; per_match → ต่อคน = Σ(`shuttles_used × price ÷ คนในแมตช์`) ของแมตช์ที่เล่น (คนถูกลบ → share หาย = under-collect); +7 vitest. `setClubMatchShuttlesAction(matchId, n)` (set/`+ลูก` = current+1). UI: `club-cost-manager` +ตัวเลือก per_match + `shuttle_price` input · `club-cost-breakdown` รับ `matches` (filter in_progress+completed → SplitMatch) ส่งเข้า computeClubSplit · `club-queue-panel` `ShuttleCounter` (+/−ลูก) บน row in_progress/completed · page guard cost-breakdown section รองรับ `per_match && shuttle_price>0`. `CostConfigSchema` +shuttle_price + per_match enum.

#### เพิ่มแมตช์เอง (manual match) — ✅ IMPLEMENTED (2026-06-07, develop)

`createClubManualMatchAction({clubId, court, sideA[], sideB[]})` — owner/co-admin, validate ฝั่งละ **≤`players_per_team`** คน (**partial roster — รวม ≥1 คน, 2026-06-17; ช่องว่าง→null**) + distinct + อยู่ในก๊วน, insert pending ที่ queue tail (ไม่บล็อกถ้าผู้เล่นอยู่ในคิวอื่น — organizer override). UI: ปุ่ม "เพิ่มแมตช์เอง" + Dialog (court picker + player Selects ฝั่ง A/B 2-or-4 ตาม players_per_team) ใน `club-queue-panel`. tsc 0 · vitest 396 · build OK.
- **Court picker → occupancy grid** (2026-06-09, develop): court `<Select>` แทนด้วย grid ของปุ่มสนาม (toggle, single-select). แต่ละปุ่มโชว์ "สนาม X" + สถานะจาก `matches.filter(in_progress)` (occupied → "กำลังเล่น: A vs B" via `resolveSide`/`nameMap`, ว่าง → "ว่าง"); สนามที่ไม่ว่างยังเลือกได้ (manual match = pending insert, ไม่ชน in_progress-only court index). Default selection = สนามว่างแรก (`firstFreeCourt(courts, matches)` — ใช้ใน lazy init + `reset()` + resync effect แทน `courts[0]`). ไม่มี action/data/migration ใหม่ — dialog รับ `matches`+`players` อยู่แล้ว.

#### แมตช์ไม่ครบคน + แก้ผู้เล่น pending + error ละเอียด — ✅ IMPLEMENTED (2026-06-17, develop)

ความยืดหยุ่นของคิว: จองแมตช์/สนามล่วงหน้าด้วยคนเท่าที่มี (แม้ 1 คน) แล้วเติม/แก้ทีหลัง.
- **Migration `20260617000100_club_match_partial_roster`** — `ALTER COLUMN side_a_player1 / side_b_player1 DROP NOT NULL` → ทั้ง 4 ช่องผู้เล่น nullable. Additive-safe (FK/CASCADE/index ไม่แตะ; trigger `club_match_player_guard` ใช้ `&&` ที่ ignore NULL อยู่แล้ว). **APPLIED to prod 2026-06-17** (verified ทั้ง 4 ช่องผู้เล่น nullable).
- **Type** `ClubMatch.side_a_player1` + `side_b_player1` → `string | null` (ตรงกับ schema); `resolveSide` รับ `string | null` (ช่องว่าง render "—").
- **`createClubManualMatchAction`** ผ่อน validation → ฝั่งละ ≤ppt + รวม ≥1 คน (เดิมบังคับครบพอดี).
- **`setClubMatchPlayersAction({matchId, sideA[], sideB[]})`** ใหม่ — แก้ผู้เล่นแมตช์ pending (เติม/สลับ/ล้างช่อง); guard `loadClubMatchForManage` + `.eq("status","pending")` (no-op → `matchCannotEditPlayers`).
- **`startClubMatchAction`** เพิ่ม `isClubMatchFull(match, ppt)` gate ก่อน flip → in_progress (ไม่ครบ → `matchNotFullToStart`).
- **`buildNextClubMatchAction`** เมื่อจัดแมตช์เต็มไม่ได้: `available>=needed` แต่ติด skill-gap/คู่ล็อก → `cannotFormMatchSkillLock`; **`1..needed-1` คน → สร้าง partial match** (`buildPartialMatch` เติมเท่าที่มี เรียงคิว A ก่อน B) แทน error; `0` คน → `notEnoughPlayersDetail {needed,available,checkedIn,playing}`.
- **UI** `club-queue-panel.tsx`: `InlinePlayerSlot` (แก้ผู้เล่น **inline ต่อช่อง** บน PendingRow ผ่าน autocomplete — **ไม่มี dialog**; ตัวเลือกกรองผู้เล่นที่อยู่ช่องอื่นของแมตช์เดียวกันออก กันเลือกซ้ำ; เลือก/ล้างช่อง = persist ทันทีผ่าน `setClubMatchPlayersAction`, optimistic local state + revert on error) · ปุ่ม "เริ่ม" `disabled` + tooltip "ต้องเลือกผู้เล่นให้ครบก่อนเริ่ม" เมื่อ `!isClubMatchFull` (คำนวณจาก local slots → flip ทันที) · ManualMatchDialog ผ่อนเช็ค "ครบทุกช่อง" + hint "สร้างค้างไว้ได้".
- **Pure** `isClubMatchFull(m, ppt)` ใน `queue.ts` (5 vitest: doubles 4-ช่อง / singles 2-ช่อง / partial). i18n th+en: 5 actions keys + 10 queuePanel keys (key-check + parity PASS). Gates: tsc 0 · vitest 640 · `next build` OK. **Live Playwright net-zero smoke PASS (prod):** manual 1-คน → DB partial row · "เริ่ม" disabled ตอน partial / enabled ตอนครบ · edit inline เติมครบ → start → `in_progress` · build บนคนหมด pool → toast "ผู้เล่นไม่พอ: ต้องการ 4 มีพร้อม 0…" · teardown 0 row. **Inline-edit redesign (2026-06-17):** เปลี่ยน `EditPlayersDialog` → `InlinePlayerSlot` (autocomplete ต่อช่องในแถว, ไม่มี dialog, ตัวเลือกกรองช่องอื่นออก, persist ทันที). Re-smoke prod: A1=Anna → dropdown A2 = [Ben,Cara,Dan] (ตัด Anna), B1 = [Cara,Dan], B2 = [Dan] → ครบ → start → `in_progress`; console 0 error; teardown 0 row.

**Create form / Settings:**

1. **จำนวนสนาม** (`court_count`) — แก้ได้ที่ settings
2. **ผู้เล่นต่อทีม** (`players_per_team`) — `1`–`2` (เดี่ยว / คู่)
3. **รูปแบบการหมุน** (`rotation_mode`) — `fair_queue` (Fair Queue) | `winner_stays` (Winner Stays — ผู้ชนะอยู่ต่อ; `winner_stays_max` = ชนะติดกี่เกมก่อนบังคับพัก, 0=∞) | `fair_winner_fallback` (หมุนเวียนทั่วถึง — 2026-06-21) = fair เป็นหลัก (จบเกมแล้วคนเพิ่งเล่นออกพัก ดึงคนพักนานสุดเข้า) แต่เมื่อ bench < 2×ppt (คนรอไม่พอตั้งทีมใหม่) → ผู้ชนะอยู่ต่อเป็น fallback. Pure helpers `keepsWinner` / `benchSufficientForFresh(pool, justPlayedIds, ppt)` / `allPlayersOf(row)` / `playersInLatestPerCourt(rows)` ใน `queue.ts`. **buildNextClubMatchAction (ship-check fix 2026-06-22):** รัน `planWinnerStays(cap=winner_stays_max)` **เสมอ** ทั้ง FAIR/FALLBACK → ตัด `reservedIds` (ผู้ชนะสนามอื่น) ออก pool ทุกเคส กันโดนแย่งไปเป็นคู่ต่อสู้; **bench = pool − `playersInLatestPerCourt`** (คนเพิ่งเล่นจบ**ทุกสนาม** ไม่ใช่แค่สนามนี้); `bench ≥ 2×ppt` → FAIR (ผู้ชนะสนามนี้ออกด้วย) ไม่งั้น FALLBACK → ผู้ชนะสนามนี้อยู่ต่อแบบ **bypass cap** ผ่าน `resolveCourtStay(thisCourtRows, 0, eligibleIds)` (shortage = ตัวคุมเอง; `winner_stays_max` มีผลเฉพาะ reservation ของสนามอื่น). query completed **ไม่กรอง** `winner_side` (แมตช์ tie/ไม่ระบุผลล่าสุดนับเป็น 'เพิ่งเล่น'). +17 vitest
4. **โหมดคิว** (`queue_mode`) — `rest_longest` พักนานไปก่อน (default · แนะนำ) | `level_match` จับคู่ตามระดับ (+ แบ่งฝั่งสมดุล) — `fifo` ตัดออก v0.25.0 (legacy fold → rest_longest)
5. **โหมดระดับฝีมือ** (`skill_level_enabled`) — **ผูกกับ queue_mode: true ก็ต่อเมื่อ level_match** (ตั้งอัตโนมัติ, ไม่มี toggle แยก v0.25.0)
6. **จำกัดเวลาต่อเกม** (`game_time_limit_min`) — นาที/เกม (`0` = ไม่จำกัด)
7. **เมื่อยังไม่เช็คอิน** (`not_ready_action`) — ใช้เช็คอินเป็นตัวบอกความพร้อม: `skip` ตัดคนยังไม่เช็คอินออกจากการจัดแมตช์ (default · = พฤติกรรมเดิม) | `requeue` ดึงได้แต่ต่อท้ายคิว (ลงเมื่อคนเช็คอินไม่พอ); มีผลเมื่อมีคนเช็คอินแล้วอย่างน้อย 1 คน

**ตั้งระดับผู้เล่น** — owner/co-admin ตั้งได้ตอนเพิ่ม guest และ**แก้ทีหลังได้** (quick-select ในแถว / ฟอร์มแก้ไขผู้เล่น / ตั้งทีละหลายคน — v0.17.0, ดูหัวข้อ Skill Levels). **ไม่มี** self-signup level picker.

---

#### ระบบคิดเงินก๊วน (Club cost split) — ✅ IMPLEMENTED (2026-06-06, develop)

**Shipped:** `src/lib/club/cost-split.ts` `computeClubSplit()` pure helper (14 vitest, worked-example exact) · migration `20260606000100_club_cost_split` (clubs +5 cost fields, club_players +`start_time`/`end_time`/`games_played`) · `updateClubCostConfigAction` + `updateClubPlayerSessionAction` (owner/co-admin) · `ClubCostManager` (settings: fees + split toggles + gap policy) · `ClubCostBreakdown` (per-player table, owner-resolves profile_id→club_players.id for gap=owner) · per-player session editor in `sortable-player-list.tsx` · wired in `clubs/[id]/page.tsx`. tsc clean · vitest 364 · prod build OK · **live smoke PASS** (seeded club, SSR breakdown rendered court 200/200/320 + shuttle 73/91/136 + total 273/291/456 exact, then deleted). **Not yet built:** rotation queue (ส่วน A) → `games_played` auto-count (manual entry for now). Design below.

**Session-UI tweaks (2026-06-06, develop):** (1) partial-window label — `sortable-player-list.tsx` แสดง `<Clock/> เล่น {effStart}–{effEnd}` ใต้ชื่อ เมื่อ window ของผู้เล่น ≠ ช่วงเต็มก๊วน (`isPartial = !!(cs && ce) && (effStart !== cs || effEnd !== ce)`); (2) `SessionEditor` pre-fill เวลา default = ช่วงก๊วน, save `null` เมื่อ == ช่วงก๊วน; (3) `HourlyHeadcount` (`src/components/club/hourly-headcount.tsx`) — การ์ดนับจำนวนคนต่อช่วง 60 นาที (`18:00–19:00 : N คน`), pure/server-renderable, นับ player ที่ effective window คลุม slot, gated `players.length > 0` ในหน้า club detail; (4) expense designated-payers (ดู section "ค่าใช้จ่ายแบบแยกรายการ"). tsc clean · vitest 364 · build OK.

**DESIGN (reference):**

ค่าใช้จ่าย 2 ก้อนแยกกัน แต่ละก้อนเลือกวิธีหารอิสระ:
- **ค่าสนาม** (`court_fee`) — `even` หารเท่า | `by_time` หารตามเวลาที่อยู่จริง
- **ค่าลูกแบด** (`shuttle_fee`) — `even` หารเท่า | `by_games` หารตามจำนวนเกมที่ลงเล่น

→ 4 combo ได้หมด (court even/time × shuttle even/games).

**Data model:**
- `clubs` (cost config): `court_fee numeric default 0`, `court_split text default 'even'` CHECK in (`even`,`by_time`), `shuttle_fee numeric default 0`, `shuttle_split text default 'even'` CHECK in (`even`,`by_games`), `court_gap_policy text default 'spread'` CHECK in (`spread`,`owner`,`ignore`). (`total_cost` เดิม = legacy; ค่อย deprecate หรือ mirror = court_fee+shuttle_fee. `club_expenses` คงไว้สำหรับ misc itemized)
- `club_players` (per-player inputs): `start_time time null` (default = `club.start_time`), `end_time time null` (default = `club.end_time`), `games_played int not null default 0`. guest (จาก add-guest ที่เพิ่งทำ) กรอกได้เหมือนกัน

**Algorithm — pure helper `computeClubSplit(input) → { playerId, court, shuttle, total }[]`** (testable, mirror tournament `scoring.ts` pattern):

*ค่าสนาม:*
- `even`: `court_fee / N` ทุกคน (N = จำนวนผู้เล่น)
- `by_time` (segment method):
  1. boundaries = sorted unique ของ {session.start, session.end, ทุก player.start, ทุก player.end} clamp ใน [session.start, session.end]
  2. แต่ละ segment `[t1,t2)`: `segDur = t2−t1`; `present` = ผู้เล่นที่ `start ≤ t1 AND end ≥ t2`; `segCost = court_fee × segDur / sessionDur`; แบ่ง `segCost / |present|` ให้แต่ละคน present
  3. share/คน = Σ segment ที่ตัวเองอยู่
  4. **gap** (`|present| = 0`): `court_gap_policy` → `spread` เฉลี่ย segCost ให้ทุกคนเท่ากัน (default, รวมครบเสมอ) | `owner` เจ้าของรับ | `ignore` ไม่เก็บ (under-collect)

*ค่าลูกแบด:*
- `even`: `shuttle_fee / N`
- `by_games`: `shuttle_fee × games_i / Σgames`; ถ้า `Σgames = 0` → fallback `even` + warn

*Rounding:* คำนวณ exact → **ปัดขึ้น (ceil) ทุกคนเป็นจำนวนเต็มบาท** (`ceilBucket`, 2026-06-09) → คนแชร์เท่ากันได้เลขเท่ากัน, `Σ` อาจ over-collect เล็กน้อย (by design ไม่ขาด). เดิมเป็น round-nearest + remainder→คนจ่ายมากสุด แต่ทำให้คนเวลาเท่ากันต่างกันหลายบาท

**Worked example** — court 720, shuttle 300; A(18–20), B(19–21), C(18–21); games A=8 B=10 C=15 (Σ=33):

| ผู้เล่น | court even | court by_time | shuttle even | shuttle by_games |
|---|---|---|---|---|
| A (2 ชม.) | 240 | 200 | 100 | 73 |
| B (2 ชม.) | 240 | 200 | 100 | 91 |
| C (3 ชม.) | 240 | 320 | 100 | 136 |
| **รวม** | 720 | 720 | 300 | 300 |

court by_time มาจาก: seg 18–19 {A,C}=240/2 · 19–20 {A,B,C}=240/3 · 20–21 {B,C}=240/2.

**UI:**
- Club settings (owner/co-admin): `court_fee` + toggle court_split, `shuttle_fee` + toggle shuttle_split, gap policy (advanced)
- Per-player: time window (start/end, default = ก๊วนเต็ม) + `games_played` stepper บน add/edit (รวม guest). ถ้า rotation queue (ส่วน A) build แล้ว → `games_played` auto-count จากแมตช์
- Cost breakdown Card: ตารางต่อคน (court share + shuttle share + total) + label วิธีหาร + grand-total reconciliation (โชว์ว่ารวมตรง)

**Edge cases:** player window นอกช่วงก๊วน → clamp; 1 คน → จ่ายหมด; `by_games` 0 เกม → fallback even+warn; ครึ่งชั่วโมง → คิดเป็นนาที OK; ใครออกแล้วกลับ (2 ช่วง) → รองรับถ้าเก็บ window เป็น array (v2; v1 = 1 ช่วง/คน)

**Pure helper signature:**
```ts
computeClubSplit(input: {
  players: { id: string; start: string; end: string; games: number }[];
  courtFee: number; courtSplit: "even" | "by_time";
  shuttleFee: number; shuttleSplit: "even" | "by_games";
  sessionStart: string; sessionEnd: string;
  gapPolicy: "spread" | "owner" | "ignore"; ownerId?: string;
}): { playerId: string; court: number; shuttle: number; total: number }[]
```
→ vitest ครอบ: 4 combo, gap, Σgames=0 fallback, rounding-sum-exact, clamp, 1-player.

**Open decisions (ยังไม่ฟิกซ์ — ถามก่อน implement):**
- reuse `clubs` / `club_players` / `club_expenses` (ปัจจุบันมี `total_cost` หารเท่าตัวเดียว) หรือ schema ใหม่/ขยาย? cost-split 2 รายการ (court + shuttle) + วิธีแบ่งต่างกัน ต้องเก็บแยก
- `by_time` ค่าสนาม → ต้อง track เวลาเข้า/ออก per player; `by_games` ค่าลูก → ต้อง count เกมที่เล่นจริง per player
- ~~queue algo `smart`~~ — ปิดแล้ว (2026-07-07): `smart` เคย = `level_match` เป๊ะ จึงยุบรวมเหลือ 3 โหมด; ปัจจัย variety (เพื่อนร่วม/คู่ตรงข้ามซ้ำ) ถูกทำจริงผ่าน batch-queue (`generateBatchQueue` + `pair-history.ts`) แล้ว
- `winner_stays` — กติกาผู้ชนะอยู่ต่อกี่เกมติด, เปลี่ยนคู่ฝั่งไหน
- skill-level scale — เลขอิสระเหมือน tournament `level` หรือ fixed scale

### หน้า Settings โปรไฟล์ + ย้าย "ออกทุกอุปกรณ์" — ✅ DONE 2026-06-10

หน้า `/settings` (route ใหม่ใน `(app)` group → `SiteHeader` + ต้อง login) รวบ account actions + แก้ display name ไว้ที่เดียว; ย้ายปุ่ม "ออกทุกอุปกรณ์" ออกจาก header/mobile-nav มาที่นี่. (theme toggle คงไว้ที่ header)

- `updateProfileDisplayNameAction` (`src/lib/actions/profile.ts`) — getSession → zod `.trim().min(1).max(40)` → update `profiles.display_name` (service role) → **`setSession(...)` re-issue cookie** (sync ชื่อใหม่ใน header ทันที โดยไม่ bump session_version → อุปกรณ์อื่นไม่หลุด) → `revalidatePath('/settings')`. ใช้ได้ทั้ง LINE + guest.
- LINE callback (`api/auth/line/callback/route.ts`) — update-first (refresh `picture_url`+`is_guest`) / insert-on-first-login (seed `display_name`) + `23505` re-read race guard. ชื่อที่ผู้ใช้แก้คงอยู่. **Trade-off: เลิก mirror ชื่อจาก LINE.**
- `/settings/page.tsx` (`force-dynamic`, server) — redirect ถ้าไม่ login; การ์ดโปรไฟล์ (avatar + ชื่อ + badge LINE/guest) + `EditProfileForm` + ปุ่ม "ออกจากระบบ" / "ออกจากทุกอุปกรณ์" (form POST `/api/auth/logout` + `/api/auth/logout-all`, ครอบ Tooltip).
- **ก๊วนของเราที่หมดอายุแล้ว (✅ 2026-06-11, merged master):** การ์ด "ก๊วนของเราที่หมดอายุแล้ว" บน `/settings` — fetch `clubs` ที่ `owner_id = session.profileId` AND `play_date < today` เรียงใหม่→เก่า, แต่ละแถวเป็น `<Link>` ไป `/clubs/{id}` (ชื่อ + venue + วันที่). owner-scoped (ไม่มี IDOR), gate `!session.isGuest` (guest สร้างก๊วนไม่ได้ → ข้าม query + ซ่อนการ์ด). เติม gap ที่ `/clubs` โชว์แค่ `play_date >= today` → ก๊วนเก่าดูย้อนหลังได้จากที่นี่. No migration · ship-check PASS (net-zero live-smoke: expired club โชว์, active club ไม่โชว์).
- **"ก๊วนของฉัน" + "ทัวร์นาเมนต์ของฉัน" (✅ 2026-06-14, develop):** 2 หน้าใหม่ scoped เฉพาะ owner + co-admin; nav links ใน `user-menu.tsx` (dropdown) + `mobile-nav.tsx` (hamburger) สำหรับ logged-in non-guest.
  - `/clubs/mine` (`src/app/(app)/clubs/mine/page.tsx`) — query clubs ที่ user เป็น owner หรือ co-admin (`club_admins`) **ไม่กรอง play_date** (รวมก๊วนเก่า), order `play_date DESC`. countMap กรองเฉพาะ club_ids ที่ query ได้ (`.in()` — ไม่ดึง club_players ทั้งตาราง).
  - `/tournaments/mine` (`src/app/(app)/tournaments/mine/page.tsx`) — query tournaments ที่ user เป็น owner หรือ co-admin (`tournament_admins`), order `created_at DESC`. ถ้าไม่ login หรือ guest → empty state.
  - i18n: `club.page.myListHeading` (TH "ก๊วนของฉัน" / EN "My Clubs") · `tournament.page.myListHeading` (TH "ทัวร์นาเมนต์ของฉัน" / EN "My Tournaments") · `tournament.page.myListEmpty` (th/en) · `nav.myClubs` + `nav.myTournaments` (th/en). tsc 0 · build OK (ทั้ง 2 routes ขึ้น `ƒ /clubs/mine` + `ƒ /tournaments/mine`).
- `EditProfileForm` (`src/components/profile/edit-profile-form.tsx`, client) — TanStack Form + zod + shadcn Input/Button/Tooltip; `router.refresh()` หลังสำเร็จ.
- `site-header.tsx` + `mobile-nav.tsx` — ลบ form "ออกทุกอุปกรณ์"; avatar เป็น `<Link href="/settings">` (desktop + mobile); mobile-nav เพิ่มเมนู "ตั้งค่า".
- Verify: tsc 0 · vitest 475/475 · guest live-smoke net-zero (แก้ชื่อ → DB update + header sync ชื่อใหม่ทันที + avatar→/settings + logout-all หายจาก header).
- **🔀 Settings reorg → /profile + presets ไป /clubs/mine (✅ 2026-06-14, develop) — supersedes lines ด้านบนที่ว่า /settings มีโปรไฟล์/ก๊วนหมดอายุ/พรีเซ็ต:** จัดระเบียบหน้า `/settings` ใหม่ตาม user — (1) **การ์ดโปรไฟล์ → หน้า `/profile` ใหม่** (`src/app/(app)/profile/page.tsx`, `force-dynamic`, server; avatar+ชื่อ+badge+`EditProfileForm`; ใช้ namespace `settings.*` เดิม ไม่เพิ่ม key); (2) **"ก๊วนของเราที่หมดอายุแล้ว" เอาออก** — ข้อมูลซ้ำกับ `/clubs/mine` ที่โชว์ทุกก๊วน (รวมเก่า, ไม่กรอง play_date) อยู่แล้ว; (3) **`PresetManager` ย้ายไป `/clubs/mine`** (อยู่ใกล้ปุ่มสร้างก๊วน — user เลือก) — `/clubs/mine` fetch presets ผ่าน `listClubPresetsAction` (gate `canCreate`). `/settings` เหลือแค่การ์ดบัญชี (logout / logout-all). **nav:** `user-menu.tsx` "โปรไฟล์" → `/profile` (แยกจาก "ตั้งค่า" → `/settings`); `mobile-nav.tsx` เพิ่มลิงก์ "โปรไฟล์". key กำพร้า `settings.pastClubsSection`/`pastClubsEmpty` ลบจาก th+en. **Verify:** tsc 0 · vitest 626/626 · build OK (`ƒ /profile` ขึ้น) · **Playwright net-zero smoke ผ่าน 4 หน้า** (`/tournaments` heading "ทัวร์นาเมนต์" · `/clubs/mine` มีพรีเซ็ต · `/settings` เหลือบัญชี · `/profile` การ์ดครบ; console 0 err จริง — มี transient ตอน Turbopack คอมไพล์ /profile ครั้งแรกเท่านั้น).
- **🇹🇭 i18n leak sweep (✅ 2026-06-14, develop):** สแกน catalog ไทยทุก namespace (ASCII-only value detector) เจอค่าแปลที่เป็นอังกฤษล้วน **10 จุด** แก้เป็นไทยหมด — `tournament.page.listHeading` "Tournament"→"ทัวร์นาเมนต์" [user-reported] · `tournament.settingsManager.{colorSummary,realtime,auditLog}` · `tournament.exportButtons.{export,template}` · `club.costBreakdown.exportCsv` · `club.levelsManager.real{,Add}AriaLabel` · `club.queueSettings.rotation{FairQueue,WinnerStays}` (+ Full/desc ให้เข้าชุด). EN catalog คงอังกฤษ (`tournament.page.listHeading` singular→"Tournaments").
- **🧹 ship-check /simplify (✅ 2026-06-15, develop):** code-review เจอ `profile.ts` `revalidatePath("/settings")` ตกค้าง (ฟอร์มแก้ชื่อย้ายไป /profile แล้ว) → แก้เป็น `/profile`. แตกการ์ดซ้ำเป็น component กลาง: `ClubCard` (`src/components/club/club-card.tsx`, async server, รับ `{club: ClubCardData, joined}`) ใช้ทั้ง `/clubs` + `/clubs/mine`; `TournamentCard` (`src/components/tournament/tournament-card.tsx`, รับ `{tournament}`) ใช้ทั้ง `/tournaments` + `/tournaments/mine`; helper `ownerOrAdminOrFilter(profileId, adminIds)` (`src/lib/owner-scope.ts`) สร้าง PostgREST `.or()` string (owner หรือ co-admin) ใช้ 3 หน้า. 4 หน้า list ผอมลง + ตัด import ที่ไม่ใช้. Smoke ผ่าน (TournamentCard/ClubCard render จริงทั้ง 4 surface, net-zero).

### ระบบ Preset ก๊วน (user-owned templates) — ✅ IMPLEMENTED 2026-06-11 (develop)

**Shipped:** migration `20260611000100_club_presets` (applied prod 2026-06-11 — `club_presets(id, owner_id FK profiles CASCADE, name, config jsonb, created_at)` + `idx_club_presets_owner` + RLS-on no-policy = service-role only). `src/lib/club/preset.ts` (`ClubPresetConfigSchema` zod + `parsePresetConfig` per-field tolerant). `src/lib/actions/club-presets.ts` — `listClubPresetsAction`/`createClubPresetAction`/`updateClubPresetAction`/`deleteClubPresetAction`/`applyClubPresetAction` (all LINE-user-only + `assertPresetOwner` fail-closed; `applyClubPresetAction` = one-shot seed: insert clubs row [name/venue/play_date=today/times/max_players/court_fee/shuttle_price/`courts=['1'..court_count]`/`queue_settings`] → co_admins [Set-deduped, skip owner, ignore 23505] → regulars [position 1..N, active≤max_players else reserve, profile_id optional] · **compensating delete of the club on any child-insert failure → no orphan club**). UI: `preset-manager.tsx` (list + เปิดก๊วน/แก้ไข/ลบ) + `preset-form.tsx` (TanStack Form dialog + regulars editor; `numberField` helper; `form.reset(toFormDefaults(preset))` explicit). `clubs/page.tsx` fetches presets **only for LINE users** (gated behind `canCreate` — guests/anon never trigger the redirecting action). `ClubPreset` type in types.ts. tsc 0 · vitest **511/511** (+36 preset tests). **Live-smoke PASS (net-zero):** seeded preset → apply → new club seeded correctly (columns + queue_settings + 5 regulars 4-active/1-reserve split) + redirect; anonymous `/clubs` renders (no redirect); console 0 err; throwaway club+preset+profile deleted, counts back to baseline. ~~co_admin picker + regular profile-link UI deferred~~ → **✅ DONE 2026-06-12 (develop):** `preset-form.tsx` เพิ่ม section ผู้ช่วยดูแล (`ProfileCombobox` ใหม่: Popover+Command `shouldFilter={false}` + debounce 250ms, mirror `co-admin-controls.tsx`; เลือกชื่อใน combobox = เพิ่มทันที ไม่มีปุ่มเพิ่มแยก) + ปุ่ม Link2/Unlink ต่อแถว regular เพื่อผูก `profile_id` (autofill ชื่อเมื่อช่องว่าง, ชื่อยังแก้ได้). Actions ใหม่ใน `club-presets.ts`: `searchPresetProfilesAction(query, excludeIds)` + `getProfileNamesAction(ids)` — LINE-gate, ILIKE-escaped, UUID-validated, คืนแค่ `{id, display_name}` (ไม่ select `line_user_id` — PII rule); เปิด dialog แก้ไข → resolve ชื่อจาก stored ids ครั้งเดียว. +13 keys `club.presetForm.*` (th/en parity).

**Original design (reference):**

Preset = เทมเพลตก๊วนที่ user **เพิ่ม/ลบ/แก้** ของตัวเองได้ เก็บ config + roster ที่ใช้ประจำ เพื่อเปิดก๊วนรอบใหม่ได้เร็ว. ตัวอย่าง: "NOMKON · วันพุธ · 19:00–21:00".

**ฟิลด์ใน preset:**
- ชื่อ (เช่น `NOMKON`)
- ตารางประจำ — วัน (เช่น วันพุธ) + ช่วงเวลา (19:00–21:00)
- `max_players` (รับสูงสุดกี่คน), `shuttle_price` (ลูกขนไก่), `court_count` (จำนวนสนาม), `players_per_team`, `rotation_mode`, `queue_mode`
- co-admins (รายชื่อ)
- **ผู้เล่นประจำ** — ชื่อ + เวลาที่มาประจำของแต่ละคน (regular's usual attend window)

**Behavior:** CRUD บน preset ของตัวเอง · "apply preset" → สร้าง/เปิดก๊วนรอบใหม่โดย pre-fill config + co-admins + add ผู้เล่นประจำ (พร้อม start/end time ประจำ).

**Preset บันทึก "ตั้งค่าผู้รับเงิน" — ✅ DONE 2026-07-05 (v0.18.0, develop):** `ClubPresetConfigSchema` เก็บ `promptpay_id`, `promptpay_name`, `promptpay_qr_image` (URL เดิม ไม่ re-upload), และ subset ของ `receipt_template` เฉพาะ `payment_show`, `bank`, `theme` (ไม่เก็บ footer/fields/logo/slip verify secrets). `preset-form.tsx` เพิ่ม section ผู้รับเงิน: PromptPay id/name, QR image URL + preview/clear, toggle PromptPay/bank, bank name/account no/account name, theme swatches; client validation + server validation ซ้ำ (`isValidPromptPayId`, bank on ต้องมี bank+account no). `applyClubPresetAction` map ค่าเหล่านี้ลง `clubs.promptpay_*` + `clubs.receipt_template` ตอน insert โดย merge กับ `DEFAULT_RECEIPT_TEMPLATE`; apply ยังเป็น one-shot seed.

เพิ่ม workflow ในหน้าก๊วน: ปุ่ม "บันทึกเป็นพรีเซ็ต" ในแท็บตั้งค่า (`SaveClubAsPresetDialog`) สำหรับ manager ที่เป็น LINE user. เลือกได้ว่าจะสร้าง preset ใหม่หรือทับ preset เดิมของผู้กด (ต้อง tick confirm ก่อน overwrite); preset owner = คนกด. Snapshot อ่านจาก server-side club row เท่านั้น: copy all supported preset fields, `schedule_day` แปลงจาก `play_date` เป็น label, roster เรียง active ก่อน reserve แล้วตาม position แต่ไม่ preserve status; co-admin copy เฉพาะ rows ใน `club_admins` ไม่เพิ่ม owner เดิมอัตโนมัติ. Security: ใช้ `assertCanManageClub` กับก๊วนต้นทาง และ `assertPresetOwner` กับ preset ที่ถูกทับ; ไม่ select/return `club_billing_secrets` หรือข้อมูลสลิป; public view ยัง redact payment receiver/receipt fields เหมือนเดิม. Tests: `parsePresetConfig` + payment receiver recovery เพิ่มเป็น 39 cases; targeted typecheck + preset vitest ผ่าน.

**Decisions — ✅ เคาะแล้ว 2026-06-11 (user):**
1. **Storage = jsonb ก้อนเดียว** — `club_presets(id, owner_id FK profiles, name, config jsonb, created_at)`; mirror `queue_settings`/tournament `settings`. preset อ่าน/เขียน/apply ทั้งก้อน → ไม่ต้อง join.
2. **apply = สร้าง club ใหม่ one-shot seed** — `applyClubPresetAction(presetId)` สร้างก๊วนรอบใหม่ pre-fill จาก config + co-admins + regulars แล้วแยกอิสระจาก preset (แก้ club ไม่กระทบ preset).
3. **Recurrence = template กดเปิดเอง (MVP)** — `schedule_day`/`start_time`/`end_time` เป็น metadata + pre-fill เท่านั้น; ไม่มี scheduling infra (auto-create ไว้ทีหลัง).
4. **Regulars = guest name + optional profile link** — แต่ละ regular = `{ name, profile_id?, start_time?, end_time? }`; apply → insert `club_players` (profile_id ถ้ามี ไม่งั้น guest).

**Config jsonb shape (zod `ClubPresetConfigSchema` ใน `src/lib/club/preset.ts`):** `venue`, `schedule_day`, `start_time`, `end_time`, `max_players`, `court_fee`, `shuttle_price`, `queue_settings: ClubQueueSettings` (full nested block), `courts: string[]`, `co_admin_ids: string[]`, `regulars: {name, profile_id?, start_time?, end_time?}[]`.

**Full queue-settings fidelity — ✅ DONE 2026-07-10 (v0.26.0, develop):** preset เก็บ **ทั้งก้อน** `queue_settings: ClubQueueSettingsSchema` (nested, single source) แทน 4 field แบน — ค่าคิวทุกตัว round-trip ผ่าน save→apply→edit ครบ (เดิม `winner_stays_max`/`game_time_limit_min`/`max_skill_gap`/`balance_strictness`/`balance_locked_pairs`/`realtime_enabled` หายกลับ default). `skill_level_enabled` ไม่ถูกเก็บ — `parsePresetConfig` normalize `queue_settings` ผ่าน `parseQueueSettings` **ก่อน** schema parse (derive skill จาก queue_mode, fold legacy, เติม default) จึงเป็น single source ของ coupling ทุก read path. preset เก่า (4 field แบน ไม่มี nested) fold จาก flat keys ก่อน parse — ไม่ต้อง migration (zod strip flat keys). เพิ่ม `courts: string[]` เก็บชื่อสนาม (fallback `['1'..court_count]` เมื่อว่าง). `preset-form.tsx` เปิดให้แก้ค่าคิวครบทุกตัว (reuse `club.queueSettings.*` i18n) + editor ชื่อสนาม local-state (ไม่ reuse `ClubCourtManager` ซึ่ง auto-save + มี side effect กับแมตช์สด); onSubmit rebuild `queue_settings`+`courts` จาก state เอง → ไม่มี field ถูกรีเซ็ตตอนแก้. `buildPresetConfigFromClub`/`applyClubPresetAction` copy ทั้งก้อน (ยุบ 2 จุด build ที่เคย drift). tsc 0 · vitest 815 (+6 preset) · build OK · i18n 810=810.

**Apply mapping** (club เพิ่งสร้าง = ว่าง ไม่มี race → insert ตรงได้ ไม่ผ่าน `add_club_player` RPC เพื่อรองรับ profile_id): clubs row (name/venue/play_date=today/start/end/max_players/court_fee/shuttle_price/`courts=config.courts` [fallback `['1'..court_count]` เมื่อว่าง]/`queue_settings=config.queue_settings` [full block]/owner_id=caller) · co_admin_ids → `club_admins` · regulars → `club_players` (position 1..N, status active≤max_players else reserve). Owner-only; gate `isGuest`. Migration `20260611000100_club_presets`.

### UX polish backlog

- **`cursor: pointer` ทุก clickable** — ✅ DONE 2026-05-25. `cursor-pointer` ใส่ที่ `buttonVariants` base (`ui/button.tsx`) → คุม `<Button>` ทั้ง app; เพิ่มที่ `ui/tabs.tsx` (TabsTrigger), `ui/select.tsx` (SelectTrigger), `ui/checkbox.tsx`, และ raw color-swatch `<button>` ใน `team-manager.tsx`. DnD drag handles ใช้ `cursor-grab active:cursor-grabbing` อยู่แล้ว (ถูกต้อง); `SelectItem`/`CommandItem` คง `cursor-default` ตาม base-ui listbox convention. tsc clean.
- **i18n ไทย/อังกฤษ** — **COMPLETE ✅ 2026-06-12 — SHIPPED master** (merge `c05ba04`; /ship-check ผ่าน: 3-finder review สะอาด + live-smoke locale flip). next-intl แบบ cookie-based (`locale` cookie, ไม่มี URL routing — mirror `theme` pattern). `src/i18n/` (config/request/locale/actions), 10 namespaces (`messages/{th,en}/*.json`): common · nav · home · auth · settings · club · tournament · stats · validation · actions. provider ใน root layout; `useTranslations` (client) / `getTranslations` (server). **architecture เต็มใน `CLAUDE.md > ## Internationalization (i18n)`** (รวม gotcha: ICU param ต้องตรง, key-checker gate, surface ที่คง Thai). ทำเป็น batch 1–5b:
  - batch 1–4: components (club + tournament + stats) + app/public pages ครบ
  - batch 5a: tournament display-label maps (match status / result / tournament status / match format) ย้ายเข้า catalog → consumers ใช้ `t(\`group.${enum}\`)`; class/badge maps คงไว้ใน lib. form validation → `validation` namespace
  - batch 5b: server-action error/toast strings ทั้ง 13 action modules → `actions` namespace (club/tournament/class/match sub-keys); `resolveMatchResult` คืน reason code + ICU translate ที่ matches.ts
  - locale switcher (TH⇄EN) อยู่ใน account dropdown (`user-menu.tsx`) — `setLocaleAction` + `router.refresh()`
  - **คง Thai โดยตั้งใจ (data/external, ไม่ใช่ UI chrome):** audit_logs `description` (data record), LINE notify body (locale ปลายทางไม่แน่นอน), ชื่อกลุ่ม generator (`กลุ่ม A`)
  - **Deferred เดิม 3 รายการ — ✅ ปิดครบ 2026-06-12 (develop):** (a) **CSV export headers** — generators ใน `csv.ts`/`cost-csv.ts` รับ labels param จาก caller (lib คง pure, ไม่ import next-intl): `MatchesCsvLabels`/`RosterCsvLabels`/`PlayerTemplateSampleLabels` + `CostCsvLabels`; keys `tournament.csv.*` (37) + `club.costCsv.*` (11); caller = `export-buttons.tsx` + `club-cost-breakdown.tsx` สร้างจาก `t()`. **Header บรรทัดแรกของ import template คงเป็น canonical ids (`team,id_player,...`) ทั้ง 2 ภาษา** — parser ใน `csv-import-dialog.tsx` ต้องการ (มี comment กำกับในไฟล์ ห้ามแปล); sample data rows แปลได้. (b) **`permissions.ts` throw strings** — ตรวจแล้ว **moot**: ทั้ง 4 helper (tournament + club) throw โค้ดภายใน `"permission_check_failed"` เฉพาะกรณี DB error ไม่เคย render เป็นข้อความ UI (เส้นทาง "ไม่มีสิทธิ์" ปกติ return false แล้ว action แปลเอง) — ไม่ต้องแก้. (c) **Date/number formatting** — helper ใหม่ `src/i18n/date-fns-locale.ts` `dateFnsLocaleOf(locale)` (en→enUS, อื่น→th); ทุกจุด date-fns `format()` 9 ไฟล์ (settings/clubs/clubs[id]/c[id]/tournaments/tournaments[id]/public-hero/audit-log-panel + Intl ใน schedule-match-card) ส่ง locale จาก `getLocale()` (server) / `useLocale()` (client); `tournament-dashboard.tsx` HH:mm en-GB คงเดิม (locale-neutral 24h by design); ตัวเลข `toLocaleString()` คงเดิม — verified grouping th/en เหมือนกัน (`1,234,567` ทั้งคู่)

## Phase 12 — `require_checkin` (DONE 2026-05-24)

**Goal**: Block `startMatchAction` until every player on both sides has `team_players.checked_in_at IS NOT NULL` when the setting is on. Mirrors the existing `require_court_to_start` pattern but gates per-player.

**DB**:
- migration `20260524000100_add_team_players_checked_in_at` — `ALTER TABLE team_players ADD COLUMN checked_in_at timestamptz` + partial index `idx_team_players_checked_in ON team_players(team_id) WHERE checked_in_at IS NOT NULL`. Applied to prod via Supabase MCP.

**Settings**:
- `tournaments.settings.require_checkin: boolean` (default `false`) added to `TournamentSettingsSchema` in `src/lib/tournament/settings.ts`.

**Types** (`src/lib/types.ts`):
- `TeamPlayer.checked_in_at: string | null` added (after `csv_id`, before `created_at`). Existing `team_players(*)` selects in `/tournaments/[id]/page.tsx` + `/t/[token]/page.tsx` pick it up automatically.

**Server actions** (`src/lib/actions/tournaments.ts`):
- `toggleTeamPlayerCheckInAction({ playerId, tournamentId })` — `assertCanEdit` (owner + co-admin); validates player.team.tournament_id; flips `checked_in_at` between `now()` and `null`; audit log `player_checked_in` / `player_checked_out`; revalidates owner + share + tv paths.
- `bulkCheckInTeamAction({ teamId, tournamentId, checkIn })` — same auth; bulk update all `team_players.team_id = teamId`; audit `team_bulk_checked_in` / `team_bulk_checked_out` with count in description.
- `revalidateAllTournamentPaths(sb, tournamentId)` private helper — looks up `share_token` and revalidates owner + `/t/[token]` + `/t/[token]/tv` (mirrors the matches.ts helper without cross-file import).

**Gate** (`src/lib/actions/matches.ts`):
- New internal helpers `collectMatchPlayerIds(sb, match)` (returns team_player ids for both sides, pair-mode-aware via `pairs.player_id_1/2`, team-mode via `team_players.team_id`) + `findUncheckedPlayerNames(sb, ids)`.
- `startMatchAction` adds a block after the `require_court_to_start` gate: when `settings.require_checkin` is true, collect player IDs, fetch unchecked names, reject `{ error: "รอเช็คอิน: <names>" }` if any.
- `recordMatchScoreAction` auto-advance path filters candidates: when `require_checkin`, iterates the queue window and skips any candidate with unready players; promotes the first fully-ready match instead of the first populated one.

**UI** (`src/components/tournament/team-manager.tsx`):
- `PlayerRow` — per-player "เช็คอิน" / "พร้อม" Button (default outline → green when checked in) with `useTransition` spinner; row container gets green tint + border when checked in (`bg-green-500/5 border-green-500/30`).
- `TeamCard` header — count Badge "X/N พร้อม" (amber-tinted while partial, solid green when 100%); icon-button `CheckCheck` (toggles all) gated by `team.players.length > 0`; uses `bulkCheckInTeamAction`. Title row gains `min-w-0 truncate` to keep the new badges from pushing the layout.

**Settings tab** (`src/components/tournament/settings-manager.tsx`):
- New `ToggleRow` under "การจัดคิว" section, after `require_court_to_start`. Wired via `commit(...)` like other toggles.

**No match-queue client gate** (deferred): client doesn't have per-player check-in state in the queue tree. The server gate + toast on `เริ่ม` failure (with the unready count) is sufficient UX for the first cut. Future polish could thread a `Map<matchId, ready>` from the page.

### Phase 12 Wave A — code-review P0 hardening (2026-05-24)

Closes the 4 most-severe findings from the max-effort review of commit `618e829`:

- migration `20260524000200_rpc_start_match_atomic` — new RPC `start_match_atomic(p_match_id uuid, p_player_ids uuid[]) RETURNS jsonb`. `SECURITY INVOKER` + `search_path = ''`, executable by `service_role` only. Locks the match row with `FOR UPDATE`, re-checks `team_players.checked_in_at IS NULL` count under a row lock, then atomically transitions `pending → in_progress`. Returns `{ ok, reason?, count? }` with reasons `not_found | completed | in_progress | unchecked | status_changed`. Closes the TOCTOU window between the JS-level gate and the prior bare `UPDATE`.
- `src/lib/actions/matches.ts`:
  - `collectMatchPlayerIds` now returns a discriminated `MatchPlayerCollection = { ok: true; ids } | { ok: false; reason: "tbd" | "empty_roster" }`. The `isPair` heuristic was changed: a pair-mode match must have BOTH `pair_a_id` AND `pair_b_id` set; same for team mode. Half-populated TBD slots and empty rosters now return explicit reasons. Both DB queries destructure `error` and **throw** on failure (no more silent `[]` defaults).
  - Replaced `findUncheckedPlayerNames` (returned names) with `countUncheckedPlayers` (`{ count: 'exact', head: true }`) — no PII leak in errors, no extra bandwidth fetching names. Error messages now read `รอเช็คอิน N คน — เปิดแท็บทีมเพื่อเช็คอิน` (count only).
  - `startMatchAction` — `require_checkin` block now wraps in `try/catch`; explicit error messages for TBD slot and empty roster; the final `UPDATE { status: 'in_progress' }` was replaced with `sb.rpc("start_match_atomic", { p_match_id, p_player_ids })`. Court 23505 collision still surfaces correctly; the RPC's reason union translates to per-case Thai errors.
  - `recordMatchScoreAction` auto-advance — same atomic RPC for promote; counts `skippedDueToCheckin` and appends it to the audit description (e.g., `... ข้ามคิว 3 แมตช์ (รอเช็คอิน)`); when every candidate is unready, writes a new `auto_advance_skipped` audit row so the queue silence is traceable. Court inherit moved to a follow-up update post-RPC (the RPC sets status + started_at only; the partial unique index on `(tournament_id, court) WHERE status='in_progress'` still guards collisions on the follow-up).

**Findings still open** (Wave B/C): roster-wide gate in team mode (V1), bulk overwrite of timestamps (V5), cross-device bulk race (S7), CSV upsert preserves stale check-in (S4), N+1 auto-advance (V9), `revalidateAllTournamentPaths` error swallow + drift (V8), missing court/stats path revalidation (S8). See review notes from the 2026-05-24 audit.

### Phase 12 Wave B+C — code-review correctness + perf (2026-05-24)

Closes Wave B (correctness) and Wave C (perf) findings.

**V5 + S7 — Bulk idempotent UPDATE** (`tournaments.ts`):
- `bulkCheckInTeamAction` now appends `.is("checked_in_at", null)` when `checkIn=true` and `.not("checked_in_at", "is", null)` when `checkIn=false`. Existing arrival timestamps survive subsequent bulk presses (V5). Cross-device race (S7) is harmless — both calls become idempotent. New return shape `{ ok: true, count: 0, noop: true }` when nothing changed; client surfaces "ทุกคนพร้อมอยู่แล้ว" / "ยังไม่มีคนพร้อม" via `toast.info`.
- `toggleBulk` captures `intendCheckIn = !allCheckedIn` at click time before await so the resolved toast reads the intent at dispatch, not stale post-refresh state.

**S4 — Manual check-in lifecycle reset** (`tournaments.ts` + `team-manager.tsx`):
- New action `resetAllCheckInsAction(tournamentId)` — owner+co-admin, sets all `team_players.checked_in_at` to NULL across every team in the tournament. Returns `{ ok, count, noop? }`. Audit event `tournament_checkins_reset` with row count.
- `TeamManager` header gains "รีเซ็ตเช็คอิน" Button (visible only when `totalCheckedIn > 0`) with `confirm()` prompt naming the current count.
- New "Total พร้อม" Badge in the header next to the team count Badge.
- Note: `importPlayersCsvAction` UPSERT already preserves `checked_in_at` (the update specifies columns explicitly, not `**spread`); the reset action gives the owner a manual lever between tournaments.

**V8 — `revalidateAllTournamentPaths` error capture + S8 broaden paths** (`tournaments.ts`):
- Now destructures `error` and `console.error("revalidateAllTournamentPaths share_token lookup:", error)` + early-returns when the lookup fails (mirrors `revalidateTournamentPaths` in `matches.ts`).
- Replaced the explicit `revalidatePath('/t/X')` + `revalidatePath('/t/X/tv')` pair with a single `revalidatePath('/t/X', 'layout')` so the entire token subtree is invalidated — covers `/court/[n]`, `/bracket`, and `/stats/{pair|player|team|division}/[id]` automatically (S8).

**V9 — Batch auto-advance check-in** (`matches.ts`):
- The auto-advance loop previously fired `collectMatchPlayerIds` (1 RTT) + `countUncheckedPlayers` (1 RTT) per candidate, up to 20 candidates = 40 sequential round-trips per score.
- New batched pre-fetch: 3 round-trips total when `require_checkin=true`:
  1. `pairs WHERE id IN (...all candidate pair ids)` — composition map
  2. `team_players WHERE team_id IN (...all candidate team ids)` — roster map
  3. `team_players WHERE id IN (...all involved players) AND checked_in_at IS NULL` — unchecked set
- Then iterates `populated` in JS, picks the first candidate with zero `unchecked.has(id)`. Same `nextPending` semantics, same `skippedDueToCheckin` accounting, same audit log behaviour. Worst-case latency drops from ~1.2-3.2s to ~50-200ms.
- Falls through safely on any batch query failure — `nextPending` remains undefined, auto-advance silently skips that score.

**V1 — Roster-wide gate (DESIGN, no code change)**:
- In team mode, `require_checkin` gates on the full roster of both teams (every `team_players.team_id` row). This is intentional: there's no "lineup" concept in the schema, and the flag's invariant ("nobody plays until everyone is checked in") is uniform across pair + team modes. Mitigation already in place via `bulkCheckInTeamAction` (one click checks in the whole team) + `resetAllCheckInsAction` (one click resets). UI exposes both. If a tournament wants partial-roster gating, recommended workflow is to leave bench-only members un-checked-in by design — but they will currently block the start. Documented as known tradeoff; do not "fix" without an explicit lineup feature.

**New event types**: `tournament_checkins_reset`, plus existing `team_bulk_checked_in/out` semantics tightened (count reflects only rows actually changed).

Tests: 269/269 vitest pass; tsc clean.

**Audit events** added: `player_checked_in`, `player_checked_out`, `team_bulk_checked_in`, `team_bulk_checked_out`.

**Tests**: `settings.test.ts` updated — `require_checkin` default false. `competitor.test.ts` + `entity-stats.test.ts` fixtures updated with `checked_in_at: null`. Vitest 269/269 passing; `tsc --noEmit` clean.

### Phase 13 — Competition mode (multi-class, team-aware grouping)

**Context.** ✅ **SHIPPED & LIVE ON PROD (Slices 1–8, 2026-06-02→04; follow-ups T1–T5 by 2026-06-08) — see "Implementation status" + "✅ Phase 13 COMPLETE" below.** `tournaments.mode = "competition"` is now selectable at create time (Slice 8 mode selector) and code paths branch on `mode` throughout; the original `sports_day`-only behavior described in the rest of this design is the *pre-Phase-13 state* it replaced. (No real tournament has used competition mode yet — verified only via throwaway live-smoke during development.) The gap this Phase closed: real Thai pair tournaments (see วีนฉ่ำ Excel reference) require structure the `sports_day` flow cannot express: classes (NB/BG/N/S/P-), per-class capacity, team-aware group assignment, and per-class brackets — all sharing one tournament's courts + queue. This Phase opened the `competition` mode and added the missing primitives.

**Architectural rule** (per user): *class is event-scoped, not player/pair attribute.* A player's "class" is whatever event they joined; pairs are linked to a class only for that tournament. Player/team master data is not touched.

#### DB schema

- migration `add_tournament_classes`:
  ```sql
  CREATE TABLE tournament_classes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    code text NOT NULL,                 -- "NB", "BG", "N", "S", "P-"
    name text NOT NULL,                 -- "มือใหม่"
    pair_capacity int,                  -- nullable = unlimited; soft cap on registration
    pairs_per_group int NOT NULL DEFAULT 4,
    format tournament_format NOT NULL DEFAULT 'group_knockout',
    advance_count int NOT NULL DEFAULT 2,
    has_lower_bracket bool NOT NULL DEFAULT false,
    allow_drop_to_lower bool NOT NULL DEFAULT false,
    match_format text NOT NULL DEFAULT 'best_of_3',  -- 'fixed_2' | 'best_of_3' | 'best_of_5'
    position int NOT NULL DEFAULT 0,    -- display order
    created_at timestamptz DEFAULT now(),
    UNIQUE (tournament_id, code)
  );
  CREATE INDEX idx_tournament_classes_tournament ON tournament_classes(tournament_id);
  ```
- migration `add_class_id_to_pairs_groups_matches`:
  ```sql
  ALTER TABLE pairs   ADD COLUMN class_id uuid REFERENCES tournament_classes(id) ON DELETE SET NULL;
  ALTER TABLE groups  ADD COLUMN class_id uuid REFERENCES tournament_classes(id) ON DELETE CASCADE;
  ALTER TABLE matches ADD COLUMN class_id uuid REFERENCES tournament_classes(id) ON DELETE CASCADE;
  CREATE INDEX idx_pairs_class    ON pairs(class_id)   WHERE class_id IS NOT NULL;
  CREATE INDEX idx_groups_class   ON groups(class_id)  WHERE class_id IS NOT NULL;
  CREATE INDEX idx_matches_class  ON matches(class_id) WHERE class_id IS NOT NULL;
  ```
- All three `class_id` columns are nullable so existing `sports_day` data stays valid. For `competition` mode tournaments, app logic enforces non-null.

#### Server actions

- `createClassAction(tournamentId, input)` — owner-only; insert into `tournament_classes`; audit `class_created`.
- `updateClassAction(classId, patch)` — owner-only; partial update; audit `class_updated` with diff keys.
- `deleteClassAction(classId)` — owner-only; cascades to groups/matches via FK; refuse when any related `matches.status='completed'` exists; audit `class_deleted`.
- `reorderClassesAction(tournamentId, orderedIds[])` — owner-only; bulk update `position`.
- `generateGroupsForClassAction(classId)` — replaces single-class generate flow. Reads `tournament_classes.pairs_per_group`, computes `group_count = ceil(pairs / pairs_per_group)`, calls **`balancedTeamGroupAssignment`** (see Algorithm), inserts into `groups` scoped to `class_id`, then triggers `generatePairMatchesForClassAction`.
- `generatePairMatchesForClassAction(classId)` — round-robin within each group; matches inserted with `class_id` + `group_id` set.
- `generateKnockoutForClassAction(classId)` — current `generateKnockoutAction` logic but seeded only from this class's group standings.

#### Algorithm — `balancedTeamGroupAssignment(pairs, pairsPerGroup) -> Group[] | InfeasibilityError`

Input: array of `{ pairId, teamId }` for one class. Output: `groups[i].pairs[]` with the **cross-team rule**: no two pairs from the same team end up in the same group, while keeping groups as balanced in size as possible.

```
1. Group pairs by teamId → teamBuckets
2. group_count = ceil(total_pairs / pairs_per_group)
3. Feasibility: for every team, pairs[team] <= group_count
   (else error: "ทีม X ส่งเกินจำนวนกลุ่ม — เพิ่ม group_count หรือลดคู่")
4. Sort teams by bucket size DESC
5. Initialize empty groups[0..group_count-1]
6. For each team in order:
   - Build a list of groups sorted ASC by current pair count
   - Assign team's pairs one at a time to the next-emptiest groups,
     skipping any group that already contains a pair from this team
7. Return groups
```

Edge cases:
- **Single team submits all pairs in a class** → infeasibility error. UI suggests "ลด pairs_per_group" or "ลดคู่ทีม X".
- **`pair_capacity` exceeded** → reject pair insert at registration; group gen never sees overflow.
- **Uneven distribution acceptable** when class total isn't a multiple of `pairs_per_group`: last group gets fewer pairs (no synthetic BYE). Standings already handle uneven groups.

#### CSV import — add `class_code`

`PairCsvRow` gains `class_code: string` (required when tournament has classes; tolerated empty when `sports_day`). Server action resolves `class_code` → `class_id` via `tournament_classes.code`. Unknown code → row-level error.

#### UI

- **Mode selector** on `new-tournament-form.tsx` + `edit-tournament-form.tsx`: radio `sports_day` / `competition`. Default = `sports_day`.
- **Class manager** in Settings tab (competition only): `ClassManager` component with table (code · name · capacity · pairs_per_group · format · advance · actions) + "เพิ่ม class" dialog. Drag handles for reorder.
- **Pair tab** (competition only): top filter `Class: [All | NB | BG | N | S | P-]`. Add-pair form: `class_id` Select (required), shows progress "X/cap". Cross-class disabled if cap reached.
- **Group/Knockout tabs**: top tabs per class (e.g. `BG · N · S · P-`); each tab is the existing single-class view scoped to that class_id.
- **Queue tab**: stays flat (shared courts). Each row prefix `[BG]` `[N]` color-coded by class.
- **TV / public**: standings + brackets grouped under class headers.
- **Generate buttons** per class — owner clicks "สร้างกลุ่ม" inside the BG tab and only BG is regenerated.

#### Settings flag integration

- Add `default_match_format` to `TournamentSettings` (replaces individual class default).
- Per-class `match_format` overrides tournament-level default.
- `gameWinner(games, format)` branches: `fixed_2` returns `"a" | "b" | "draw"` based on the 2-game outcome; `best_of_3` / `best_of_5` majority logic.

#### Backward compat

- Existing tournaments stay `sports_day` with `class_id = NULL` everywhere — current flows untouched.
- "Upgrade to competition mode" action: owner can convert; system creates a single default class (`code = "MAIN"`, all existing pairs/groups/matches assigned to it). Audit logged. One-way for safety.

#### Permission matrix (additions)

| Action | isOwner | isCoAdmin |
|---|---|---|
| Create/edit/delete classes | ✓ | ✗ |
| Reorder classes | ✓ | ✗ |
| Generate groups/bracket per class | ✓ | ✓ |
| Assign pair to class | ✓ | ✓ |

#### Estimated effort

- DB + types + `TournamentClass` type: 1 h
- Server actions (5 class CRUDs + 3 generate replacements): 3 h
- `balancedTeamGroupAssignment` + unit edge cases: 2 h
- `ClassManager` UI + reorder + dialog: 2 h
- Pair tab class filter + selector: 1 h
- Group/Knockout per-class tabs wiring: 2 h
- CSV import `class_code`: 1 h
- `match_format` branching in `gameWinner` + ScoreForm clamp: 1 h
- Mode selector + upgrade action: 1 h
- Spec update + manual test: 1 h
- **Total ~15 h (2 working days)**

#### Open questions

- Should knockout brackets cross classes (a "Tournament of Champions" cross-class final)? Default: **no** — each class is fully self-contained, no cross-class matches. Add later as Phase 14 if requested.
- Manual match in pair mode — restrict to same class? Default: **yes**.
- Cross-team rule: when truly infeasible (one team dominates a class), allow override flag `allow_intra_team_group: true` in `tournament_classes`? Default: **off**; document workaround as "ลด pairs_per_group" first.

#### Implementation status

- **Slice 1 — DB foundation DONE (2026-06-02, develop)**: migrations `20260602000100_add_tournament_classes` (table + RLS read-all policy mirroring peer tables + `idx_tournament_classes_tournament`) and `20260602000200_add_class_id_to_pairs_groups_matches` (nullable `class_id` FK on pairs `ON DELETE SET NULL`, groups/matches `ON DELETE CASCADE` + partial indexes) applied to prod via MCP. **Schema deviation from spec above**: `format`/`match_format` are `text` + CHECK (not a `tournament_format` enum — the project has no pg enums; `tournament.format` is text), and added guard CHECKs (`pairs_per_group > 0`, `advance_count >= 0`, `pair_capacity >= 0`). Types: `TournamentClass` + `MatchFormat` added to `src/lib/types.ts`; nullable `class_id` added to `Pair`/`Group`/`Match`; 6 test fixtures updated (`class_id: null`). tsc clean · 315 vitest pass · backward-compat (existing sports_day rows keep `class_id = NULL`).
- **Slice 3 — grouping algo DONE (2026-06-02, develop)**: `src/lib/tournament/class-grouping.ts` — `balancedTeamGroupAssignment(pairs: {pairId,teamId}[], pairsPerGroup) → { ok:true; groups:string[][] } | { ok:false; error }`. Cross-team rule (no two same-team pairs in one group), deterministic (sorted teams + lowest-index tie-break), feasibility error when a team exceeds groupCount. 24 vitest cases (`__tests__/class-grouping.test.ts`) incl. cross-team-rule assertion + determinism.
- **Slice 2 — server actions DONE (2026-06-02, develop)**: `src/lib/actions/classes.ts` — CRUD (`createClassAction`/`updateClassAction`/`deleteClassAction`/`reorderClassesAction`, owner-only; delete refuses when class has any `status='completed'` match) + generate (`generateGroupsForClassAction`/`generatePairMatchesForClassAction`/`generateKnockoutForClassAction`, `assertCanEdit`). All DML scoped by `class_id` (siblings untouched); reuses `generateAllPairMatches`/`computeStandings`/`buildBracket`/`buildDoubleBracket`. KO seeds **top-N per group** (not overall). Class matches carry `division = NULL`. Mirrors matches.ts BYE-cascade + audit/permission/revalidate conventions.
  - **Gate fix (matches.ts)**: `startMatchAction` KO-R1 group-completion gate is now **class-aware** — scopes by `class_id` when set (each class's KO gates only on its own group matches), else by `division` (sports_day), else all. Prevents one class's KO from being blocked by sibling classes.
  - Known follow-up: `match_format` per-class is stored but `gameWinner` does not yet branch on it (Slice 4); `allow_drop_to_lower` independent-lower-bracket path is team-mode-only (class KO uses `buildDoubleBracket` when `has_lower_bracket`).
- **Slice 4 — match-format logic DONE (2026-06-02, develop)**: `src/lib/tournament/match-format.ts` — `MATCH_FORMAT_BOUNDS` (fixed_2: 2 games, draw OK; best_of_3: first to 2; best_of_5: first to 3), `MATCH_FORMAT_LABEL_TH`, `maxGamesForFormat`, `isMatchComplete(games, format)` validator. `default_match_format` added to `TournamentSettingsSchema` (default `best_of_3`). 11 vitest cases. **Deviation from spec**: `gameWinner` is NOT given a `format` param — its "most games won → winner; tie → draw" counting is already format-agnostic (fixed_2's 1-1 draw and bo3/bo5 majority both fall out of the same count), so a format arg would be a no-op. Format constrains game COUNT (enforced via `maxGamesForFormat`/`isMatchComplete` in ScoreForm + record validation — wired in Slice 5/6), not the winner calc.
- **Slice 5 — ClassManager UI DONE (2026-06-02, develop)**: `src/components/tournament/class-manager.tsx` — table (code/name/capacity/pairs_per_group/format/advance/match_format) + add/edit Dialog (TanStack Form v1 + zod, format-conditional fields) + delete (confirm + surfaces server guard error) + @dnd-kit reorder (mirrors court-manager debounce/serialized writes). Owner-gated; Tooltip-wrapped actions; SelectValue render-child (Base UI). Wired in `page.tsx` (fetch `tournament_classes` ordered by position; render in Settings tab **only when `tournament.mode === "competition"`**) + `default_match_format` Select added to `settings-manager.tsx`. tsc clean · 350 vitest pass. **Visually verified** (2026-06-02) via reversible mode-flip: temporarily set NOMKONZ `mode=competition` + 2 sample classes, screenshotted Settings @1280/390 (zero overflow) + add-class dialog (Selects show labels, format-conditional fields, TanStack form), then reverted DB. **Hydration-error fix during verification**: `<DndContext>` was nested INSIDE `<table>` (between thead/tbody) — dnd-kit renders hidden screen-reader live-region `<div>`s at the context position, and a `<div>` inside `<table>` is invalid HTML → hydration mismatch. Moved `<DndContext>` to wrap the whole `<table>`; `<SortableContext>` still wraps `<tbody>` (renders no DOM). ScoreForm format-clamp deferred to Slice 6 (needs match→class→format thread).
- **Slice 6 — per-class tabs + class assignment + queue prefix + format clamp DONE (2026-06-03, develop)**: wires the Slice 2 generate actions into the UI so competition mode is reachable + viewable end-to-end. Architecture (per advisor): **isolate the competition path, gate every branch on `mode === "competition"`, reuse leaf components — never retrofit the team-only `GroupStage` (it reads `group_teams` + hard-codes `unit="team"`, so pair-groups would render empty).**
  - **Tab gating (`page.tsx`)**: `showGroups`/`showKnockout` now branch on `isCompetition` — in competition (match_unit=pair) they gate on whether ANY class uses that stage (`anyClassHasGroup`/`anyClassHasKnockout`), so the กลุ่ม + น็อคเอ้า tabs appear for pair tournaments. Threads `classes`, `pairs`, `classById` (Map<id,TournamentClass>), `matchFormatById` (Map<id,MatchFormat>) to the stages. groupsTab/knockoutTab render the competition component when `isCompetition`, else the existing sports_day stage.
  - **NEW `class-group-stage.tsx` (`ClassGroupStage`)**: competition group view — class sub-tabs (shadcn Tabs by class code); each class scopes `groups.filter(g => g.class_id === cls.id)` and renders pair-group cards. `PairGroupCard` derives competitors from the group's own matches (`pair_a_id`/`pair_b_id`) and computes standings via `computeStandings(matches,"pair",ids)` (no `group_teams` rows for pair-groups). Reuses `StandingsTable`/`MatchList`/`ScoreMatrix` (unit="pair"). Per-class buttons → `generateGroupsForClassAction` (สุ่มกลุ่ม) + `generatePairMatchesForClassAction` (สร้างตารางใหม่).
  - **NEW `class-knockout-stage.tsx` (`ClassKnockoutStage`)**: thin per-class wrapper — class sub-tabs; each renders the existing `<KnockoutStage>` fed class-filtered matches/pairs + class `advance_count`/`format` + class-scoped group counts. Class matches carry `division=NULL` → KnockoutStage's single null-division bracket path renders them cleanly (no parallel renderer needed). KnockoutStage gained optional `classId?` prop → generate button swaps to `generateKnockoutForClassAction(classId)`.
  - **Pair tab class assignment (`pair-stage.tsx` + `pair-manager.tsx`)**: in competition the คู่ tab is class-assignment only (the division-based แข่งขัน/คะแนน sub-tabs are omitted — group matches live in the กลุ่ม tab). `CreatePairForm` gains a required class `Select` (Base UI render-child); `createPairAction` extended with optional `classId` (validates class∈tournament, inserts `class_id`). `PairItem` shows a class-code badge.
  - **Queue class prefix (`match-queue.tsx`)**: `MatchQueue` accepts `classById`; `DivisionBadge` renders a `[CODE]` tag (primary-tinted, Tooltip=class name) before the division/KO badges when `match.class_id` is set. Early-return guard fixed (`div==null && !isKO && !cls`) so competition group matches (no division, not KO) still show the class badge.
  - **ScoreForm format clamp (`score-form.tsx` + `match-row.tsx` + `match-list.tsx` + `match-queue.tsx`)**: `ScoreForm` gains optional `maxGames?` — hides/guards the "เพิ่มเกม" button at the cap (never truncates existing games). Resolved from `match.class_id → class.match_format → maxGamesForFormat`, threaded via `matchFormatById`/`classById` maps. **Gated on `class_id != null` only** — sports_day matches stay free-form (avoids capping legacy 2-game draws / unlimited entry). MatchRow memo comparator extended for the new map prop.
  - tsc clean · vitest **350 pass** (no regression) · production build OK · **live browser smoke PASS** (Playwright, throwaway competition tournament seeded in prod Supabase then deleted — create-then-cleanup, verified count=0). 4/4 assertions: (A) generate-groups → 2 group cards with non-empty pair standings (PairGroupCard render — the load-bearing claim); (B) queue `[BG]` class badge; (C) ScoreForm clamp at 3 rows (best_of_3) + saved a 2-game result; (D) generate-knockout → single bracket (`division=null`, no multi-division layout). **Console/hydration clean — 0 errors, 0 hydration mismatches.**
  - ~~**Deferred to polish (not blocking)**~~ → **✅ ALL DONE 2026-06-11 (roadmap #6, develop, commit `183994e`, /ship-check PASS)**: (1) pair-tab `[ทั้งหมด|…]` class filter (shadcn Tabs) + per-class `X/cap` chip (count `pairs.class_id` vs `pair_capacity`, " เต็ม" at cap) — filter narrows by **team** (teams with ≥1 pair in class), not per-pair, since PairManager is per-team; (2) class-color coding — `classTone(index)`/`classToneById(classes, classId)`/`NEUTRAL_TONE`/`ClassTone` in `src/lib/tournament/class-color.ts` reuse `DIVISION_COLORS` (cycle-of-8, **no color column / no migration**), applied to pair-manager badge + `match-queue` `DivisionBadge` + class tab dots; index keyed to full `position` order everywhere → colors consistent across pair-tab/queue/stage-tabs/bracket; (3) bracket page (`/tournaments/[id]/bracket`) now one **section per class** (filter `m.class_id`, class-colored header, skip empty, `+` "ไม่ระบุ Class" bucket for null/unknown class_id; sports_day single-view unchanged). tsc 0 · vitest 475/475.
  - **Follow-ups noted (see bug.md)**: (1) [P2] queue tab renders 0 rows on the FIRST hard-nav right after a class generate action — reload fixes; RSC route-cache staleness, masked by soft-nav/Realtime in normal use. (2) ~~`recordMatchScoreAction` validates only `games.length >= 1` server-side — format clamp client-only~~ **RESOLVED by T1 (2026-06-08)** — see T1 note below.
- **Slice 7 — CSV `class_code` import DONE (2026-06-04, develop)**: `PairCsvRow` gains `class_code`; `importPairsCsvAction` fetches `tournament_classes` (code→id map), and **when the tournament has any class** each row must carry a known `class_code` — unknown/empty code → row skipped + collected; resolved code → `class_id` written into the insert/update payload. sports_day tournaments ignore `class_code` (no classes → `class_id` stays null). Return shape gains `unknownClassCodes: string[]`; the dialog toasts `ไม่พบ class: …` when non-empty. `generatePairImportTemplate(teams, classCodes=[])` adds a `class_code` column (header + sample = first code) only when classes are passed. `CsvImportDialog` gains optional `classCodes` prop → class-aware template + columns hint (`class_code *` + list of valid codes) + preview column + unknown-code toast; wired from `pair-stage.tsx` (competition branch) and `export-buttons.tsx` (`classCodes` threaded from `page.tsx`). tsc clean · vitest 350 · prod build OK. (Lower-risk than Slice 6: no new RSC/client boundary — class lookup is a Map.get over the proven `pairs` insert path; static-verified, live import smoke not run.)
- **Slice 8 — mode selector + upgrade-to-competition DONE (2026-06-04, develop)**: closes Phase 13.
  - **Schema/actions** (`tournaments.ts`): `mode` added to `TournamentSchema` (`sports_day` default). `createTournamentAction` now persists `parsed.data.mode` (was hard-coded `sports_day`). `updateTournamentAction` signature narrowed to `Omit<CreateTournamentInput,"mode">` and **strips `mode` from the update payload** — an edit can never reset a competition tournament back to sports_day (would orphan its classes).
  - **Create form** (`create-tournament-form.tsx`): new "โหมด" radio (กีฬาสี/ทั่วไป · Competition). Selecting Competition force-sets `match_unit=pair`, hides the team/pair selector (read-only note), and hides the division-threshold input (competition uses classes, not divisions).
  - **Edit form** (`edit-tournament-form.tsx`): mode is NOT a free toggle (one-way safety). sports_day + owner → dashed "อัปเกรดเป็น Competition" button (confirm() prompt, "เปลี่ยนกลับไม่ได้"); competition → read-only "Competition mode" badge. New `isOwner` prop threaded from `page.tsx`.
  - **`upgradeToCompetitionAction(tournamentId)`** (`classes.ts`, owner-only): refuses if already competition; creates one default class `code="MAIN"`/`name="ทั่วไป"` mirroring the tournament's `format`/`advance_count`/`has_lower_bracket`/`allow_drop_to_lower` + `match_format` from `settings.default_match_format` (fallback `best_of_3`); assigns every existing group + match (tournament-scoped) and pair (team-scoped) with `class_id IS NULL` to MAIN; **flips `mode` LAST** so a partial-migration failure leaves the tournament in its original state; audit `tournament_upgraded_to_competition`. One-way (no downgrade path).
  - tsc clean · vitest 350 · prod build OK · **live browser smoke PASS** (throwaway sports_day tournament w/ pairs+group+match seeded in prod, upgraded via the edit-form button, then deleted). Verified: MAIN class created + mode=competition + all 3 child types migrated (DB-confirmed) + competition tabs/MAIN sub-tab/ClassManager render; create-form Competition gating hides match_unit + threshold. **Console/hydration clean — 0 errors.**

**✅ Phase 13 (Competition mode) COMPLETE** — Slices 1–8 all shipped. Multi-class pair tournaments: class CRUD + team-aware grouping + per-class group/knockout + match-format + class assignment (UI + CSV) + mode selector + one-way upgrade. All gated on `mode="competition"`; sports_day untouched (backward-compat, `class_id` NULL).

- **T1 — server-side match_format enforcement DONE (2026-06-08, develop)**: closes the Slice 6 follow-up (2) — `recordMatchScoreAction` no longer trusts client-only clamp. New pure `resolveMatchResult(games, format)` in `match-format.ts` (reuses `MATCH_FORMAT_BOUNDS`; returns `{ok:true, winner}` | `{ok:false, reason}`): rejects empty games, any tied individual game (`g.a===g.b`), over-length, fixed_2 ≠ 2 games, and best_of_N where neither side clinched. In `recordMatchScoreAction`, when `match.class_id != null` the class's `match_format` is fetched and `resolveMatchResult` gates the write (its `reason` becomes the `{ error }` returned to the existing UI channel); the resolved winner replaces `gameWinner` for class matches. **sports_day (class_id null) stays on the lenient `gameWinner` majority path** — no behavior change for existing tournaments. The KO-no-draw guard was **generalized** from `round_type === "knockout"` to `round_type !== "group"` (behavior-identical today — stored round_type is only `"group"|"knockout"` — but now also rejects a `fixed_2` class KO that ties 1-1 regardless of any future bracket-specific round_type, and closes the same latent hole for sports_day double-elim). Decision: `fixed_2` is allowed as a class format even with a KO stage, but a 1-1 in any non-group round is rejected at record time (referee must break the tie). 10 new vitest cases in `match-format.test.ts`. tsc clean · vitest **416 pass** · prod `next build` OK. (No live smoke — pure-helper + single-action change over the proven `record_match_score` RPC path, no new RSC/client boundary; static-verified.)

- **T5 — granular queue realtime DONE (2026-06-08, develop)**: new opt-in setting `queue_payload_sync` (TournamentSettingsSchema, **no migration**, default **false**). When ON (and `realtime_enabled`), `match-queue.tsx` opens its own `postgres_changes` channel and **patches individual match rows from UPDATE payloads** into its existing local `items` state (matches has `REPLICA IDENTITY FULL` → `payload.new` carries every column) — no full-page refetch for score/status/court/queue_position changes. INSERT/DELETE fall back to `router.refresh()` (new/removed matches need related data the payload lacks). **The page-level `TournamentLiveWrapper` debounced refresh is left untouched** as the authority + safety net, so T5 is purely additive — it cannot regress the working path; worst case is redundant work that converges. **Race handling:** a `suppressPatchRef` pauses realtime patches for the whole drag→reorder→commit window (`onDragStart`/`onDragCancel` + cleared in the reorder transition) so an incoming `queue_position` UPDATE can't fight the optimistic drag order. Gated `realtime_enabled && queue_payload_sync` at both call sites (`/tournaments/[id]`, `/t/[token]`); toggle in `settings-manager.tsx`. tsc clean · vitest **421** · prod build OK. **✅ Single-client happy path LIVE-VERIFIED (2026-06-08)**: temporarily flipped both flags ON on a real *completed* tournament, drove the public queue page via `playwright-cli`, and confirmed the full path end-to-end with temp `console.log` instrumentation — `channel status: SUBSCRIBED` (subscription fires), a real `UPDATE matches SET court=…` delivered the `postgres_changes` payload to the handler carrying **every column** (REPLICA IDENTITY FULL confirmed live: payload had `court` + `status`), `setItems` patched the matching row, and the new value rendered into the DOM. All instrumentation + flag/data changes reverted afterward (net-zero; no committed code or prod data changed; working tree == HEAD). **⚠️ Still unverified:** (1) multi-client concurrency — concurrent multi-court updates, optimistic-vs-payload reconciliation, dnd-vs-realtime — genuinely needs ≥2 simultaneous clients (not exercisable single-client); (2) the INSERT/DELETE `router.refresh()` fallback branch (low risk — identical to the existing page-wrapper refresh, no new logic). Shipped default-OFF; the UPDATE-patch core is now proven, the race behavior still needs a live multi-court test before recommending broad use.
- **T2 — knockout "best Nth place" bracket fill DONE (2026-06-08 team mode; 2026-06-11 class/competition mode, develop)**: new opt-in setting `knockout_fill_byes` (TournamentSettingsSchema, **no migration** — settings jsonb; default **false**). When ON, fills empty knockout slots with the best non-advancing teams/pairs ranked cross-group (e.g. best 3rd-placers) instead of leaving first-round BYEs. Pure helpers in `bracket.ts`: `selectBracketFillers(rest, need)` (ranks by finishing position → pts → diff → pf; returns ≤ need; no mutation) + new `standingsToFillers(restRows, startRank, nameOf)` (maps `StandingRow`-shaped objects → `BracketFiller[]`; pure, no scoring.ts dependency). **Team mode** (matches.ts `generateKnockoutAction`): collects non-advancers into `restAdvancers`, pushes fillers after `advancers.length>=2` check. Gated off the independent-lower-bracket path (`has_lower_bracket && !allow_drop_to_lower` consumes next-rank teams → would double-allocate). **Class/competition mode** (classes.ts `generateKnockoutForClassAction`, `group_knockout` branch only — `knockout_only` seeds all pairs directly and is untouched): per-group loop now also calls `standingsToFillers(standings.slice(advanceCount), advanceCount+1, nameOf)` accumulating into `restFillers: BracketFiller[]`; after loop fetches settings via `getTournamentSettings` and if `knockout_fill_byes` pushes `selectBracketFillers(restFillers, need)` onto `seeds`. No independent-lower guard needed for class mode — class `group_knockout` always uses `buildDoubleBracket` or `buildBracket` (never `buildIndependentDoubleBracket`, which is team-mode-only and private to matches.ts). Settings toggle label updated in `settings-manager.tsx` to mention both team and competition mode. vitest **516** (511 prev + 5 new `standingsToFillers` cases) · tsc 0 · prod build OK. **Not live-tested** — default-off; fill logic unit-tested, action wiring static-verified.
- **T3 — tournament level → levels table FK DONE (2026-06-08, develop)**: closes the deferred tournament-scope half of the level system (club scope shipped 2026-06-07, commit 3ed3af5). `team_players.level` (free-text, parseFloat-prone to drift: `"3,5"`/`"N"`/whitespace) replaced by `level_id` FK → `levels` (shared editable skill table: real 1=BG … 4=P). **Migration** `20260608000100_add_team_players_level_id` (EXPAND only — additive `level_id uuid REFERENCES levels ON DELETE SET NULL` + FK index + backfill `WHERE real = parseFloat(level)`; applied to prod with explicit user confirm; **100% backfill** — all 72 prod players mapped, 0 unmapped; old `level` text column LEFT IN PLACE, dropped later in a separate confirmed migration). `pairs.pair_level` STAYS TEXT (numeric sum string) so `divisions.ts` is untouched; verified **0/36** existing pairs' pair_level differs from `real(p1)+real(p2)` → no division shift. New shared pure helper `src/lib/tournament/levels.ts` (`pairLevelString`, `realOf` — `levels.real` is a STRING in JSON, `embeddedReal`); every pair_level compute site calls it (no re-impl). Server (`pairs.ts` `createPairAction`, `tournaments.ts` `addTeamPlayerAction`/`updateTeamPlayerAction`/`importPlayersCsvAction`/`importPairsCsvAction`) now writes `level_id` and STOPS writing the `level` text column; `updateTeamPlayerAction` **recomputes pair_level for every pair containing the edited player** (closed a pre-existing stale-pair_level-on-level-edit gap). Action signature change: `level` → `level_id: string | null`. UI (`team-manager.tsx` add+edit, `pair-manager.tsx` badge, `player-stats-view.tsx`) switched the free-text Input to a **level Select** (mirrors club `add-guest-player.tsx`; Base UI `NONE_SENTINEL` for the empty option) showing `levels.label`; pages (`/tournaments/[id]`, `/t/[token]`, admin+public `stats/player/[id]`) fetch `getLevelsAction()` and thread `levels: Level[]`. **Decision: Select-only** (no free-numeric escape hatch — that reintroduces the drift T3 kills); the shared scale caps at P=4 (prod needs nothing above); tournament CONSUMES the levels table, level CRUD stays in the club settings UI. tsc clean · vitest **416 pass** (fixtures gain `level_id`) · prod build OK · **live smoke** (public `/t/[token]` + `stats/player` render HTTP 200, 0 errors, level label renders). Admin Select interaction not Playwright-tested (mirrors the proven club Select pattern).
- **T4 — collapsible divisions on match page DONE (2026-06-08, develop)**: `knockout-stage.tsx` (`<Collapsible>` per division, default open, `closedSet`/`isDivOpen`) and `pair-stage.tsx` "แข่งขัน" sub-tab were **already** collapsible from earlier work; the only remaining expanded spot was `pair-stage.tsx` "คะแนน" (standings) sub-tab — its per-division `StandingsTable` cards rendered all-open with no toggle. Wrapped each in the same `<Collapsible>` pattern, **reusing the existing `isOpen`/`setOpen` (`closedSet`) state** so a division's open/closed state is consistent across the แข่งขัน + คะแนน tabs. The division `EntityLink` (→ division stats page) is kept as a sibling link beside the chevron `CollapsibleTrigger` (not nested inside the trigger button). Added a `(completed/total)` count to the header. tsc clean · prod build OK. (No live smoke — pure presentational change mirroring the already-live matches-tab Collapsible in the same component; no new RSC/client boundary, no invalid DOM nesting.)

### From real-world reference (วีนฉ่ำ #2 xlsx)

Excel `/Users/x/Desktop/กำหนดการแข่งขันและผลคะแนน รายการวีนฉ่ำ ครั้งที่ 2.xlsx` (130 pairs, 5 classes NB/BG/N/S/P-, 6 courts, sheets: รายชื่อรวม/กติกา/ตารางเวลา/RunMatch/Class _/KO-_/สรุปรายการรางวัล) — patterns to adopt:

**Medium features**:

- **Per-court referee view** — `/t/[token]/court/[n]` — DONE (2026-05-24). New public page; `[n]` = URL-encoded court name (free text, decoded via `decodeURIComponent`). Filters matches by `court=courtName`; shows all in_progress (large card) + top 2 pending sorted by `queue_position ?? match_number` (normal card). No LIVE badge is shown as of 2026-07-05. Empty state when no matches. Auto-refresh: `TournamentLiveWrapper` (Supabase Realtime, respects `realtime_enabled`) + `TvAutoRefresh` (30s polling fallback). Phone-first layout: `max-w-xl mx-auto px-4 py-6`. Elapsed time (mm:ss) computed server-side from `started_at`. No admin controls. Single new file: `src/app/(public)/t/[token]/court/[n]/page.tsx`.
- **Prize summary page** — new field `tournaments.prize_template jsonb` = `[{rank:1, label:"ชนะเลิศ", cash:10000, trophy:true}, …]` per tournament. Page `/tournaments/[id]/prizes` auto-computes champion + runner-up + semifinalists from KO bracket per class. Print-friendly for award ceremony.
- **Entity stats drill-down (player / pair / team / division)** — clickable name anywhere in the app → opens stat page showing match history + win/loss/draw aggregates for that entity. 4 entity types:
  - **Pair** (`/tournaments/[id]/stats/pair/[pairId]` + `/t/[token]/stats/pair/[pairId]`): **DONE Phase A (2026-05-24)**. Per-pair history. Metric cards: played / W-D-L / win rate / points diff. Streak pill. Match history list. Head-to-head table vs each opponent. Division badge inferred from match data.
    - Data layer: `src/lib/tournament/entity-stats.ts` — `computePairStats({ pairId, matches })` → `EntityStats`. Pure function, uses `gameWinner` + `sumGameScores` from `scoring.ts`. 12 vitest tests in `__tests__/entity-stats.test.ts`.
    - View: `src/components/tournament/stats/pair-stats-view.tsx` (`"use client"`). Mobile-first grid (2-col → 4-col sm), div-based tables (no new shadcn dep), `TournamentLiveWrapper` for Realtime refresh.
    - Admin route: `src/app/(app)/tournaments/[id]/stats/pair/[pairId]/page.tsx` — requires session (any logged-in user); `force-dynamic`.
    - Public route: `src/app/(public)/t/[token]/stats/pair/[pairId]/page.tsx` — token-based, no auth; `force-dynamic`.
  - **Player** (`/tournaments/[id]/stats/player/[playerId]` + public `/t/[token]/stats/player/[playerId]`): **DONE Phase B (2026-05-24)**. All completed matches where player appears (via any pair they belong to). Metric cards: played / W-D-L / win rate / points diff. Streak pill. Player header: name + level + team badge (colored border + dot). Match history list (side detection via Set of player's pair IDs). Partner breakdown table (partner name | P W L D). Head-to-head vs opponent pairs table.
    - Data layer: `computePlayerStats({ playerId, pairs, matches })` → `EntityStats` (extended with `partnerBreakdown?: Map<string, PartnerRecord>`). `computeStreak` refactored to accept `isSideA: (m: Match) => boolean` callback — shared by both `computePairStats` and `computePlayerStats`. 12 new vitest tests (234→246 total) in `__tests__/entity-stats.test.ts`.
    - View: `src/components/tournament/stats/player-stats-view.tsx` (`"use client"`). Same layout pattern as pair-stats-view. Team badge uses inline `style={{ borderColor, color }}` matching team.color; colored dot via `backgroundColor`. `pairById: Map<string, PairWithPlayers>` prop — player names derived in-component (no extra prop).
    - Admin route: `src/app/(app)/tournaments/[id]/stats/player/[playerId]/page.tsx` — requires session; fetches player directly from `team_players` then validates `team_id` belongs to tournament; `force-dynamic`.
    - Public route: `src/app/(public)/t/[token]/stats/player/[playerId]/page.tsx` — token-based, no auth; same validation pattern; `force-dynamic`.
  - **Team** (`/tournaments/[id]/stats/team/[teamId]` + `/t/[token]/stats/team/[teamId]`): **DONE Phase C (2026-05-24)**. Aggregates all completed matches across all pairs in the team (intra-team matches excluded). Metric cards: played / W-D-L / win rate / points diff. Streak pill. Per-pair breakdown table (pair | P W L D sorted by wins). Match history list (shows "which team pair" + opponent). Head-to-head vs opponent teams.
    - Data layer: `computeTeamStats({ teamId, pairs, matches })` → `EntityStats`. `headToHead` keyed by opponent **team** id (not pair id); built via `pairId → teamId` lookup from `pairs`. Intra-team matches (both `pair_a_id` and `pair_b_id` belong to same team) are skipped. 6 new vitest tests.
    - View: `src/components/tournament/stats/team-stats-view.tsx` (`"use client"`). Props: `stats`, `team: Team`, `teamPairs: PairWithPlayers[]`, `competitorById`, `teamById: Map<string, Team>`. Per-pair breakdown computed in-component (not in helper). Team color dot + colored Badge in header.
    - Admin route: `src/app/(app)/tournaments/[id]/stats/team/[teamId]/page.tsx` — requires session; validates `team.id` in tournament teams list; `force-dynamic`.
    - Public route: `src/app/(public)/t/[token]/stats/team/[teamId]/page.tsx` — token-based, no auth; same validation; `force-dynamic`.
  - **Division** (`/tournaments/[id]/stats/division/[divKey]` + `/t/[token]/stats/division/[divKey]`): **DONE Phase C (2026-05-24)**. Filters by `matches.division === String(division)` column directly (does not recompute from pair levels). `divKey` URL param parsed as `parseInt(decodeURIComponent(...))`, validated 1..N (N = `pair_division_thresholds.length + 1`). Metric cards: total matches / pairs that played / pairs in division / avg points per match. Pair standings table (reuses `computeStandings("pair", divisionPairIds)` sorted by league points → point diff → points for). Recent matches section (last 6 in reverse order). No streak / no global head-to-head (not meaningful at division level).
    - Data layer: `computeDivisionStats({ division, pairs, matches, thresholds })` → `EntityStats`. `headToHead` = per-pair standings within division (pair_id → {played, wins, losses, draws}) — used by the view's standings table. `pointsFor`/`pointsAgainst` = raw side-A/side-B aggregate across all division matches. `played` = number of completed division matches. `wins`/`losses`/`draws` = mirrored aggregate (each match contributes one W + one L per side). 8 new vitest tests.
    - View: `src/components/tournament/stats/division-stats-view.tsx` (`"use client"`). Props: `stats`, `division: number`, `divisionPairs: PairWithPlayers[]`, `competitorById`. Colored border on header card using `divisionTone(division).border`. Standings from `computeStandings` (not from `headToHead`).
    - Admin route: `src/app/(app)/tournaments/[id]/stats/division/[divKey]/page.tsx` — requires session; `notFound()` when division out of range or thresholds empty; `force-dynamic`.
    - Public route: `src/app/(public)/t/[token]/stats/division/[divKey]/page.tsx` — token-based; same range validation; `force-dynamic`.
    - Design choice: `headToHead` in `EntityStats` for division holds **per-pair standings** (pair_id → W/L/D), not team-vs-team h2h. Documented in JSDoc. Phase D linking can use this to build clickable pair rows.
  - **Linking (Phase D)**: **DONE (2026-05-24, commit `069de0e`)**. Every competitor name in `match-row.tsx`, `match-queue.tsx` (CompetitorLine), `standings-table.tsx`, `tv-match-card.tsx`, `bracket-match-card.tsx` is wrapped in `<EntityLink>` → its stat page.
    - Shared component: `src/components/tournament/stats/entity-link.tsx` — derives base path from `usePathname()` (admin `/tournaments/[id]/stats/...` vs public `/t/[token]/stats/...`); accepts `entityType: "pair" | "player" | "team" | "division"` + `entityId`; falls back to plain span when no tournament path detected (e.g. dashboard).
    - Tab change progress: `use-tab-sync.ts` `onChange` now wraps `router.replace` in `useTransition` and pairs it with manual `progress.start()` / `progress.stop()` calls via `useProgress()` from `@bprogress/next` — ensures the top bar shows during the new tab's lazy-mount + Suspense window (otherwise shallow `{scroll:false}` replace would skip auto-tracker).
    - Player-level links: ✅ DONE 2026-05-27. `pair-manager.tsx` PairItem player names (แยก p1 / p2) + `team-manager.tsx` PlayerRow name → `<EntityLink entityType="player" entityId={p.id}>`. Hover mini-summary tooltip ยังไม่ทำ.
  - **Post-review hardening (2026-05-24, commits `a3da9c9` `8320a7b` `9ddf197` `57c5606`)**: 26 review findings fixed across P1/P2/P3.
    - BYE walkovers (`games=[]`) now skipped in all `compute*Stats` loops — `gameWinner([])` returned `"draw"` previously, polluting W/L/D + streak for every KO bracket with odd entries.
    - UI dedup: 4 shared primitives under `src/components/tournament/stats/shared/` (`streak-pill.tsx`, `stat-header-cards.tsx`, `match-history-list.tsx`, `head-to-head-table.tsx`) + `src/lib/tournament/result-display.ts` constants/helpers — ~250 LOC removed from 4 stat-view files.
    - **Table migration (2026-05-26)**: `match-history-list.tsx` + `head-to-head-table.tsx` rewritten from hand-rolled CSS-grid `<div>` to shadcn `<Table>` (`src/components/ui/table.tsx`, added via `npx shadcn@latest add table`). Columns now auto-align across rows (each grid row was a separate container → header/row misalignment requiring fixed-rem tracks; semantic table resolves structurally). `เกม` column = `hidden sm:table-cell`, sizes to content (no truncate/fixed-rem). Exported API unchanged — 3 caller stat-views untouched. Numeric cells `text-right tabular-nums`; W/L/D colors preserved.
    - Page boilerplate dedup: `src/lib/tournament/stats-page-data.ts` (`loadStatsTournamentByAdmin` + `loadStatsTournamentByToken`) + `src/components/tournament/stats/stats-page-shell.tsx` — 8 stat pages now ~30-65 LOC each (was ~80-95).
    - `EntityStats` refactored to discriminated union (`PairStats | PlayerStats | TeamStats | DivisionStats`); `headToHead: Record` (was Map, RSC-safer); `partnerBreakdown` required on `PlayerStats` only.
    - `computeDivisionStats` filters cross-bucketed matches via `divisionPairIds` set; `winRate` pinned to 0 (formula `wins/(wins+losses+draws)` always ~0.5 for division aggregate).
    - `computeTeamStats` intra-team matches filtered at predicate (was loop continue) → `matches[]` + `streak` consistent with W/L/D counts.
    - `computePlayerStats` skips matches where player owns both pairs (data anomaly).
    - `tournament-dashboard.tsx matchesKey` extended with `team_a_score+team_b_score`, `court.length`, `started_at` — was missing these fields → stale chart on court reassign.
    - `EntityLink` uses `usePathname().startsWith()` guard (not just `useParams`); short-circuits self-links; JSDoc warns callers must gate `entityType="division"` on `thresholds.length > 0`.
    - Bug fixes: `decodeURIComponent` try/catch → 404 not 500 (court + 2 division pages); tab progress hang on same-tab click; division `thresholds=[]` silent empty → `notFound()`; content-visibility CLS on court Card removed; tv-match-card court name truncate; `notifyTournamentEvent(settings?)` reuse caller's snapshot.
  - **Public mode**: passes `isOwner=false` — read-only, no edit affordances.
- **Granular queue Realtime sync (payload-driven row updates + optimistic UI)** — replace the current `router.refresh()` debounce pattern in `MatchQueue` with row-level Realtime mutation. Today every Supabase change → 800ms debounce → full RSC re-stream → entire tree reconcile. Goal: only the changed rows update; ~10× faster perceived latency.
  - **Client store**: lift `MatchQueue` items from re-derive on `useEffect([matches])` to a `useReducer` keyed by `match.id`. Initial state seeded from server props; subsequent updates come from Realtime payloads or local optimistic mutations.
  - **Realtime payload handler**: in `TournamentLiveWrapper` (or a new `useQueueRealtime` hook), subscribe to `matches` filter `tournament_id=eq.{id}`. On INSERT/UPDATE/DELETE: dispatch reducer action with the row payload directly — no `router.refresh()` needed for queue tab. Keep the debounced refresh as a fallback for non-queue-tab consumers (dashboard, standings) that need recompute.
  - **Optimistic UI**: when user drags-drops/starts/cancels/resets a match — apply reducer mutation immediately + fire server action in background. On error → revert + toast. Uses standard React 19 `useOptimistic` if available, else manual rollback ref.
  - **Visual diff**: when a Realtime payload arrives, briefly flash that row with `bg-amber-50 transition-colors duration-700` then fade. Helps multi-admin tournaments see another organizer's actions live.
  - **Live timer**: for `in_progress` matches show elapsed `mm:ss` since `started_at`. Update via `setInterval(1000)` once per page (not per row) → broadcast tick to rows via context. Pause when tab hidden via `document.visibilitychange`.
  - **Conflict resolution**: last-writer-wins by row `updated_at`. If optimistic local change is older than incoming server payload → server wins. Add `updated_at timestamptz` to `matches` (Postgres trigger to auto-update).
  - **Scope guard**: only queue tab + TV upcoming carousel benefit. Standings/dashboard still need full recompute → keep `router.refresh()` for `tournaments` table updates + `matches.status='completed'` payloads only.
  - **Backwards compat**: feature-flag via `settings.queue_payload_sync` (default off until proven). Falls back to current debounced refresh if flag off.
- **Wheelspin / random prize draw** — new field `tournaments.prize_pool jsonb` = `[{label:"เสื้อ", qty:5}, {label:"ลูกแบด", qty:10}, …]` per tournament. Page `/tournaments/[id]/wheelspin` — pool of participants (all players or filter by team / present check-in) shown on a spinning wheel; owner triggers spin, animation lands on winner, name auto-removed from pool for next draw. Persist `prize_draws (id, tournament_id, prize_label, winner_player_id, drawn_at, drawn_by)` for audit. Also broadcast winner to TV page (overlay banner ~10s). Use case: end-of-day giveaways at sports day events.
- **Minigame: Spin Wheel (generic, free-entry)** — standalone วงล้อสุ่ม ที่ผู้ใช้ **เพิ่ม/ลบ entry ได้ไม่จำกัด** + **กำหนดสีต่อ entry เอง**. ต่างจาก Wheelspin ด้านบน (ดึงจาก participant pool + prize_draws audit): อันนี้รับ label อิสระ ไม่ผูกกับ players/tournament. **Open decisions**: (1) standalone tool หรือผูกกับ tournament/club? (2) persist entries ที่ไหน — เริ่ม client-only (localStorage / state) ก่อน แล้วค่อยมี table ถ้าต้อง share; (3) สี — color picker ต่อ entry (default = สุ่มจาก palette ที่ contrast พอ); (4) ผลลัพธ์ — แค่ highlight ที่หยุด หรือเก็บ history + remove-after-spin toggle. **UI**: list ของ entry (input label + swatch สี + ปุ่มลบ) + canvas/SVG วงล้อ + ปุ่มหมุน (easing animation). Reuse ได้ทั้ง prize draw, สุ่มคู่/สนาม, จับฉลากทั่วไป. MVP = client-only component ก่อน.

**Big feature** (gated on user demand):

- **Multi-class tournament** — Excel splits 5 classes (NB/BG/N/S/P-) in one event, sharing courts + queue but with independent groups/KO/standings/prizes. Currently 1 tournament = 1 format. Refactor:
  - New `tournament_classes` table: `(id, tournament_id, code, name, format, has_lower_bracket, advance_count, settings jsonb)`
  - Move `groups.class_id`, `pairs.class_id` (nullable for back-compat), `matches.class_id`
  - Queue stays at tournament level (shared courts)
  - Standings + KO + prize aggregate per class
  - Big refactor — do only when user organizes a real multi-class event

**Already aligned** (no change needed):

- Match number grand serial — `matches.match_number` already global per tournament ✓
- Master roster CSV — current roster export covers `รายชื่อรวม` (just add `code` column after CODE auto-gen ships)
- Per-court status banner — Phase 10 `MatchQueue` "สถานะสนาม" card already does this

### From Class NB/BG/N/S/P- sheets (group-stage patterns)

130 pairs split across 35 groups (4 pairs/group, fixed). Each class sheet has identical round-robin layout — patterns:

- **Round-robin score matrix view** — ✅ DONE 2026-05-27. Toggle "ตาราง"/"Matrix" ข้าง match list ทั้ง GroupCard (`unit="team"`) + PairStage division cards (`unit="pair"`). Component generic `score-matrix.tsx` + pure helper `score-matrix.ts` (`buildScoreMatrix`). Cell จากมุม row: games-won `2:1` + แต้มรวม `42-38` สี W/L/D; `·` = scheduled; ว่าง = no fixture (intra-team ใน pair mode เพราะ `generateAllPairMatches` จับ inter-team เท่านั้น). 38 vitest (269→307, รวม post-review hardening). ดู section "Score Matrix View (2026-05-27)" ด้านบน.
- **My matches view (per-pair schedule)** — ✅ DONE 2026-05-30. หน้า full-timeline ของคู่เดียว: `/t/[token]/pair/[code]` (public) + `/tournaments/[id]/pair/[code]` (admin mirror; `[code]` = pair UUID). 3 sections: **กำลังแข่ง** (in_progress + court + elapsed) · **ถัดไป** (pending sort `queue_position ?? match_number` + court + queue # + scheduled_at conditional + opponent) · **จบแล้ว** (completed score ผ่าน `MatchHistoryList` reuse, BYE excluded). Player-facing mobile-first `max-w-xl` + `TournamentLiveWrapper` + `TvAutoRefresh` 30s.
  - Data: reuse `loadStatsTournamentByToken` / `loadStatsTournamentByAdmin` (`stats-page-data.ts`) — ไม่มี query ใหม่. guard `match_unit !== "pair"` → notFound; `decodeURIComponent(code)` try/catch → notFound.
  - Pure helper `src/lib/tournament/pair-schedule.ts` — `partitionPairMatches(matches, pairId)` → `{inProgress, pending, completed}`; completed กรอง `games.length>0` (BYE excluded — `gameWinner([])` คืน "draw"). 8 vitest (293→301).
  - Component `pair-schedule-view.tsx` (server) + `schedule-match-card.tsx` (extracted จาก `court/[n]/page.tsx` — court page refactor ใช้ shared card; เพิ่ม optional props `court`/`queuePosition`/`scheduledAt`/`coloredDivision`; court page ส่ง default → zero behavior change).
  - Linking `pair-schedule-link.tsx` (mirror EntityLink แต่ชี้ `/pair/[code]` ไม่ใช่ `/stats/`; **exact-match self-guard `pathname===href`** เพราะ `/stats/pair/<id>` ลงท้ายด้วย `/pair/<id>` — endsWith จะ misfire).
  - 4 entry points (มี `{/* my-matches-link */}` marker ทุกจุดให้ถอดง่าย): standings-table row (gate `unit==="pair"`), pair-manager `PairItem`, pair-stats-view header ("ดูตารางแข่ง" cross-link), **tournament-dashboard `renderRankRow`** (Top performers — ชื่อ wrap `EntityLink` + ไอคอน `CalendarClock` → schedule, gate `unit==="pair"`; เป็นทางเข้าจากแท็บ default บน `/t/[token]`).
  - `pair-schedule-view.tsx` ต้องเป็น `"use client"` — ส่ง `isSideA` callback เข้า `MatchHistoryList` (client component) จาก server component ไม่ได้ (Next 16 "Functions cannot be passed to Client Components"). `ScheduleMatchCard` ไม่มี server-only dep → ใช้ใน client tree ได้.
  - team variant `/team/[id]` = deferred (team mode รวมหลาย pair).
  - tsc clean · vitest 301 · next build OK · smoke prod (NOMKONZ #2 token `d019d8a0`, pair `6a4d3ab4`): HTTP 200 + render ถูก, invalid pairId/token → 404.
- **Tiebreak criteria printed next to table** — ✅ DONE 2026-05-27. `StandingsTable`: Tooltip บน `Pts` header ("ชนะ = 3 · เสมอ = 1 · แพ้ = 0") + footer line "เกณฑ์จัดอันดับ: คะแนน → ผลต่างแต้ม → แต้มที่ได้". หมายเหตุ: `computeStandings` sort จริง = `leaguePoints → pointDiff → pointsFor` (ไม่มี H2H / จับฉลาก) — footer สะท้อนเกณฑ์จริง ไม่ใส่ขั้นที่ยังไม่ implement.
- **Group size enforcement (4 pairs/group fixed)** — Excel always uses 4. Current `groupCount` slider auto-distributes, but uneven groups (e.g. 14 pairs ÷ 3 groups = 5+5+4) common in real events. Already supported; document recommended group size = 4 in tooltip.
- **Advance rule supports "best of Nth place"** — NB rule: top 2 + best 4 third-placed teams across all groups → KO 16. Currently `advance_count` = top N per group only. **TODO** (Phase 12+): new field `tournaments.advance_rule jsonb` shape `{ top_per_group: 2, plus_best_nth: { rank: 3, count: 4 } }`. `seedsFromStandings` reads this and aggregates the best-of-rank pool across groups using existing tiebreak.
- **Sequential CODE per class** (NB1..NB24) is separate from master CODE (NBA1..NBF4). Skip — adopting master CODE alone is enough.

- **Queue bracket preference (knockout double-elim)** — ❌ ตัดทิ้ง (ตกรุ่น 2026-05-27). แทนที่ด้วย `queue_division_order` (`sequential`/`interleaved`/`chunked`) + `queue_division_priority[]` ตั้งแต่ N-division refactor — priority array ครอบคลุม upper/lower-first ได้แล้ว. `queue_bracket_preference` เหลือแค่ legacy translator ใน `normalizeLegacy()` (test เท่านั้น) — ไม่มีใน production code (`settings.ts` / `matches.ts` ใช้ `queue_division_order`).
- **Court Select placeholder bug** — ✅ DONE 2026-05-26. base-ui `Select.Value` ไม่ resolve label จาก controlled `value` (จับ text ของ `SelectItem` ตอน user คลิกเลือกเท่านั้น) → initial `value="__none"` (sentinel เพราะ base-ui ห้าม value=`""`) แสดงค่าดิบ. Fix: children render-function บน `SelectValue` map `__none` → label + `placeholder`. Label เปลี่ยนจาก "ว่าง" → `"-"` (กัน collision กับ "ว่าง" ใน banner สถานะสนาม ที่หมายถึงสนามไม่มีใครใช้ — คนละความหมาย). แก้ 4 จุดใน `match-queue.tsx`: SelectValue placeholder + fallback, SelectItem `__none`, free-text Input placeholder. banner สถานะสนาม (L200 `ว่าง`) คงไว้

### Queue reorder swaps match_number (2026-05-20)

User intent: queue numbers in รอแข่ง / กำลังแข่ง / จบแล้ว ต้องแสดง `match_number` ตรงๆ. การลากจัดอันดับใน รอแข่ง + ปุ่ม "จัดคิวอัตโนมัติ" ให้ swap `match_number` ระหว่าง pending matches กันเอง. `in_progress` / `completed` rows คง `match_number` เดิมไม่ถูกแตะ.

- migration `rpc_swap_pending_match_numbers` — new RPC `swap_pending_match_numbers(p_tournament_id uuid, p_ordered_ids uuid[])`:
  - `pg_advisory_xact_lock(hashtext(tournament_id::text))` per-tournament
  - Validates every id ใน `p_ordered_ids` belongs to tournament AND `status='pending'`; RAISE EXCEPTION ถ้าหลุด
  - Collects current `match_number` values, sorts ASC
  - Two-pass write: pass 1 → temp negative (`-1`, `-2`, …) เพื่อ dodge UNIQUE constraint; pass 2 → assign sorted match_numbers ในลำดับ `p_ordered_ids[i]`
  - **แก้ไขต่อยอด (สถานะปัจจุบันบน prod):** `20260520171351_rpc_swap_pending_match_numbers_positive_offset` — pass 1 เปลี่ยนเป็น offset บวก `+1000000` (แทน negative) · `20260704000200_swap_pending_lock_rows_before_validate` (✅ applied 2026-07-06) — `FOR UPDATE` row-lock target matches ทันทีหลัง advisory lock **ก่อน** validate → serialize กับ `start_match_atomic` ปิด race "แมตช์ in_progress ถูก renumber กลางเกม" (R2/I6 — ดู T5 race-hardening + bug.md dated 2026-07-06)
- `src/lib/actions/matches.ts`:
  - `reorderMatchQueueAction` + `autoRotateQueueAction` swapped to RPC `swap_pending_match_numbers` (was `reorder_tournament_queue`)
  - Both pre-filter ids ให้เหลือเฉพาะ `status='pending'` ก่อน call RPC (กัน race ระหว่าง client compute → server)
- `src/components/tournament/match-queue.tsx`: รหัสที่แสดง = `#${match.match_number}` ทั้ง 3 sub-tabs (เดิม `queue_position ?? match_number`)
- Page sort: `tournaments/[id]/page.tsx` + `/t/[token]/page.tsx` queue sort = `.order("match_number")` only (drop `queue_position` secondary)
- `queue_position` field ใน DB ยังอยู่; writes ใน cancel/reset/createManual/start/auto-advance เป็น dead writes — defer cleanup
- Migration applied via Supabase MCP เท่านั้น (Supabase CLI ลองแล้ว fail เพราะไม่มี local Docker stack)

### DB performance indexes + parallel page fetches (2026-05-21)

- migration `20260521000100_add_fk_indexes` — 14 covering indexes for unindexed FKs flagged by Supabase performance advisor: `matches.team_a_id` / `team_b_id` / `next_match_id` / `loser_next_match_id`, `pairs.player_id_1` / `player_id_2`, `group_teams.team_id`, `team_players.profile_id`, `clubs.owner_id`, `club_admins.user_id` / `added_by`, `club_players.profile_id`, `club_expenses.club_id`, `tournament_admins.added_by` + replacement `idx_tournament_admins_user_id` (dropped duplicate `tournament_admins_user_id_idx`). Speeds up JOIN embeds + cascade DELETEs; write overhead negligible at current volume; all `CREATE INDEX IF NOT EXISTS` idempotent.
- **Parallel page fetches**: `tournaments/[id]/page.tsx` (6 sequential awaits → 3 waves: `session+tournament` || `teams+groups+matches` || `pairs`), `/t/[token]/page.tsx` (4 → 3 waves), `/t/[token]/tv/page.tsx` (4 → 3 waves). Cuts page TTFB by ~half on hot path.
- **Co-admin can use Settings tab**: `updateTournamentAction`, `updateCourtsAction`, `updateTournamentSettingsAction` switched from `assertIsOwner` → `assertCanEdit`. Settings tab content split: `CourtManager` + `SettingsManager` + `EditTournamentForm` gated by `canEdit`; `ShareControls` + `CoAdminControls` still `isOwner`. Permission matrix above already reflects this (rows: "Update tournament settings", "Edit courts / tournament form" → ✓ for co-admin).

### Public dashboard + TV layout rework (2026-05-21)

- `src/components/tournament/public/public-overview.tsx` (Overview tab on `/t/[token]`) — body replaced with 3 stacked sections (NOTE: this file was later DELETED 2026-05-22 commit `294dafb`; the Overview tab was dropped from the public shell — content listed below for historical context only):
  1. **คะแนนรวมทีม** — team-mode: `computeStandings(allMatches, 'team', teamIds)` directly; pair-mode: aggregate pair StandingRows by `pairs.team_id` via inline `aggregatePairStandingsToTeams` helper (sums played/W/D/L/PF/PA, recomputes `leaguePoints` + `pointDiff`, sorts pts→diff→PF). Shows W-D-L column. Hidden when no team has `played > 0`.
  2. **คะแนนตามคู่ แยก Div** (pair mode only) — reads `tournament.pair_division_thresholds[]`; `computePairDivision(pairLevel, thresholds)` → Division 1..N. `md:grid-cols-2` grid, card border+title colored by `divisionTone(n)`. `thresholds=[]` → single "อันดับคู่" card.
  3. **ตารางคิว** — in-progress rows highlighted (`bg-green-500/5`) + green ping dot in title; then next 6 pending rows sorted by `queue_position ?? match_number`, TBD-only matches filtered out. Uses existing `MatchRow size="comfortable"`. Empty state "ยังไม่มีคิว".
- Recent results ("ผลล่าสุด", top 5) kept below as 4th card.
- `src/app/(public)/t/[token]/tv/page.tsx` — landscape no-scroll rework: outer `h-screen w-screen overflow-hidden flex flex-col p-3 lg:p-4`. Header `shrink-0` (tighter padding + smaller hero text). Main `flex-1 min-h-0 grid grid-cols-12 gap-4 lg:gap-6`: left `col-span-8` กำลังเล่น/ถัดไป (limited to 4 TvMatchCards), right `col-span-4 grid grid-rows-2 gap-4` with อันดับ (top 6) on top and จบล่าสุด (top 4) on bottom. Each panel `h-full overflow-hidden flex flex-col` with `shrink-0` header + `flex-1 min-h-0 overflow-hidden` body. `TvMatchCard` untouched. `TournamentLiveWrapper` + `TvAutoRefresh` + `force-dynamic` preserved.

### N-division refactor Wave 3b — UI layer (2026-05-21)

- **`settings-manager.tsx`**: `queue_bracket_preference` Select replaced with `queue_division_order` Select (`sequential`/`interleaved`/`chunked`) + new `DivisionPriorityRow` sub-component (comma-separated text input, sanitize on blur, show when order ≠ interleaved) + `queue_chunk_size` NumberRow (show when chunked only). New `pairDivisionThresholds: number[]` prop (default `[]`) feeds `divisionCount()` for max-N hint. Import: `divisionCount` from `src/lib/tournament/divisions`.
- **`edit-tournament-form.tsx`**: `pair_division_threshold: z.number().nullable()` → `pair_division_thresholds: z.array(z.number()).default([])`. Default value reads `tournament.pair_division_thresholds`. Old single `<Input type="number">` replaced with `ThresholdChipList` component (chip per threshold, × to remove, "+ เพิ่ม threshold" inline input, preview "→ N Division" count). Imports: `Badge`, `X`, `Plus`, `useState`.
- **`create-tournament-form.tsx`**: same schema + defaultValues + `ThresholdChipList` changes mirrored from edit form.
- **`public-overview.tsx`**: removed binary `upperPairStandings` / `lowerPairStandings` arrays; replaced with `divisionBuckets: Map<number, StandingRow[]>` built via `computePairDivision`. JSX renders N cards in `md:grid-cols-2` grid, each card border+title colored by `divisionTone(n)` / `divisionLabelTh(n)`. `thresholds=[]` → single "อันดับคู่" card unchanged. Import: `computePairDivision`, `divisionLabelTh`, `divisionTone`, `divisionCount`.
- **`tv/page.tsx`**: already N-division-aware from prior work; import `computePairDivision` confirmed present; no structural change needed.
- **`tv-match-card.tsx`**: no division badge in this component; no change needed.
- **`tournaments/[id]/page.tsx`**: passes `pairDivisionThresholds={t.pair_division_thresholds ?? []}` to `<SettingsManager>`.

### Dashboard tab + KO badge guard + chart_orientation (2026-05-22)

- **NEW Dashboard tab** — first/default tab "แดชบอร์ด" on tournament detail page (private + public share). Visible to ALL viewers (no `canEdit` gate). Component: `src/components/tournament/tournament-dashboard.tsx`. Sections:
  1. **Summary cards**: teams/pairs count, total players, total matches with completed/in-progress/pending subtitle, progress % with bar.
  2. **`TeamSummary`** (moved from Teams tab) — "คะแนนสะสมแต่ละทีม" chart.
  3. **Top performers** — 2 cards "อันดับสูงสุด" (top 5 by points) + "ผู้ชนะมากสุด" (top 5 by wins), with right-aligned division sub-tabs (ทั้งหมด · Div 1..N) when `match_unit === "pair"` && `pair_division_thresholds.length > 0`.
  4. **Charts**: "คะแนนรวมต่อทีม/คู่" top-10 bar chart (team color in team mode, accent in pair mode) + "Win/Draw/Loss แยก Division" stacked bar chart (only when divisions configured).
  5. **Court usage / timeline**: bar chart of matches per court + last 10 completed matches with HH:mm time, names, score.
- Lazy-mounted via existing `mounted: Set<TabId>` pattern in `tournament-tabs.tsx` + `public-tournament-shell.tsx`. Tab ID = `"dashboard"`.
- **`TeamManager` simplified** — no longer takes `matches` / `pairs` / `matchUnit` props (TeamSummary moved out of the Teams tab).

- **`match-queue.tsx` DivisionBadge — KO pill + bracket guard (commit 75e4bc3)**:
  - Renders yellow "KO" pill (tooltip "น็อคเอ้า") for any match where `round_type === "knockout"`.
  - Shows existing W/L/F bracket badges ONLY for KO matches (previously they leaked into group matches because DB default `bracket='upper'` on every row). Group matches no longer show bogus "Winner bracket" tooltips.

- **Settings UX polish (commit 75e4bc3)** — `settings-manager.tsx`:
  - Helper text for Division priority field: `"ลำดับ Div ที่จะลงสนามก่อน (เช่น 2,1) — ว่างไว้ = 1..{N}"` (was the older "1=สูงสุด" phrasing).
  - Base UI `<SelectValue>` for `queue_division_order` now uses an explicit render-function child to map enum value → Thai label (`interleaved → "สลับ"`, `sequential → "ตามลำดับ"`, `chunked → "เป็นชุด"`). Without the render function the trigger displayed the raw enum value.

### New setting `chart_orientation` (2026-05-22)

| Flag                | Default    | Wire point                                                                                          |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `chart_orientation` | `vertical` | Affects all 4 bar charts: `TeamSummary`, Dashboard points top-10, Dashboard W/D/L per Division, Dashboard court usage. |

- Schema (`src/lib/tournament/settings.ts`): `chart_orientation: z.enum(["vertical", "horizontal"]).default("vertical")`.
- `"vertical"` = category on X axis, value on Y, `LabelList position="top"`. `"horizontal"` = recharts `layout="vertical"`, category on Y, value on X, `LabelList position="right"`.
- `TeamSummary` takes an `orientation` prop; Dashboard reads from `tournament.settings.chart_orientation`; TV page passes `orientation={settings.chart_orientation}` to `TeamSummary` call sites.
- UI: new toggle under "การแสดงผล + Privacy" section in Settings tab.

### Production DB cleanup (2026-05-22)

- Direct SQL (no migration) — deleted 15 test tournaments via `DELETE FROM tournaments WHERE id <> 'acc3f738-4156-435d-a87b-b2242ed31d31'`. FK cascades dropped 57 teams, 48 players, 8 pairs, 10 groups, 60 matches, 84 audit_logs.
- Kept only "NOMKONZ TOUNAMENT #2" (id `acc3f738-4156-435d-a87b-b2242ed31d31`).
- `clubs*` tables untouched.

### TV display rework — 3-column + carousels + settings (2026-05-22)

Major redesign of `/t/[token]/tv` from a 8/4 grid into a fully-configurable 3-column TV scoreboard. All new TV behavior controlled by tournament settings (no DB migration; jsonb).

**Layout** — `src/app/(public)/t/[token]/tv/page.tsx`:
- Body: `h-screen w-screen overflow-hidden flex flex-col` (locked landscape, no vertical scroll).
- Header: name + venue + status pill + `<TvFullscreenButton/>` + "ดูสาย" link (only when `knockoutCount > 0`) + "ออก TV" link.
- Main: `grid grid-cols-12 gap-4`; each section `col-span-4 h-full overflow-hidden flex flex-col`. Empty columns render as placeholder `<div className="col-span-4" />` to keep the 4/4/4 invariant regardless of which toggles are off.
  - **Left (col-span-4)** — `<TvUpcomingCarousel inProgress={...} pending={...} intervalMs={settings.tv_upcoming_interval_sec*1000} />`
  - **Middle (col-span-4)** — `<TvStandingsCarousel pages={allStandingsPages} intervalMs={settings.tv_carousel_interval_sec*1000} fontSize={settings.tv_standings_font_size} />`
  - **Right (col-span-4)** — `<TeamSummary size="tv" orientation="vertical" fillParent />` (gated by `tv_show_team_chart`)
- `pendingMatches.slice(0, 6)` — fixed cap of 6 (no longer user-configurable; the previous `tv_upcoming_count` setting was removed).
- The old "จบล่าสุด" section was dropped from rendering entirely; settings keys `tv_show_completed` / `tv_completed_count` still exist in schema but no UI consumes them.

**New components**:
- `src/components/tournament/tv-fullscreen-button.tsx` — `'use client'`, tracks `document.fullscreenElement` via `fullscreenchange` listener, toggles `requestFullscreen()` / `exitFullscreen()`, `<Maximize/>` ↔ `<Minimize/>` icon.
- `src/components/tournament/tv-upcoming-carousel.tsx` — 2-page rotating carousel:
  - **Page 1 "กำลังเล่น"** — all `in_progress` matches sorted by `match_number`.
  - **Page 2 "ถัดไป"** — top-6 `pending` matches sorted by `match_number`.
  - Pages with empty match list are filtered out (no blank slide).
  - Layout: `grid grid-rows-6 gap-2` — every card occupies 1/6 of column height regardless of how many matches are in the current page, so a single in_progress card has the same visual size as one of six pending cards.
  - Auto-rotates every `intervalMs` when both pages have matches; dot indicators are `<button>` (`onClick={() => setActive(i)}`), `aria-label` + `aria-current`, hover state; `setInterval` cleaned up on unmount.
- `src/components/tournament/tv-standings-carousel.tsx` — extended with `fontSize?: "sm" | "md" | "lg" | "xl"` prop. `FONT_SIZE_CLASS` constant maps each size to `{table, rowMaxName}` Tailwind class pairs (table text + row name max-width).
- `src/app/(public)/t/[token]/bracket/page.tsx` — NEW public TV-mode bracket page. Mirrors data-fetch pattern of `/t/[token]/tv/page.tsx`; renders upper / lower / grand_final via `buildVisualBracket` + `<BracketView/>` × 3 sections separated by `<Separator/>`; same header layout as TV page with fullscreen button + "ออก" → `/t/${token}/tv`; `force-dynamic` + `TournamentLiveWrapper` + `TvAutoRefresh`. Updated 2026-05-22 — tournament lookup uses `.maybeSingle()` (was `.single()`, hard-crashed on missing token); honors `settings.tv_refresh_interval_sec`; for pair-mode KO, splits per Division (1..N) via `computePairDivision` and renders one bracket section per division.

**TvMatchCard** (`src/components/tournament/tv-match-card.tsx`) — refactored to compact-only mode:
- `density` / `comfortable` mode REMOVED; only the previous "compact" variant remains. All call sites simplified.
- New `fillHeight?: boolean` prop: when true, card uses `h-full flex flex-col gap-2` (with `shrink-0` header + `flex-1 min-h-0` content row) so it fills its parent height; when false, card uses `space-y-2` natural height.
- Multi-tier `nameSize(name)` — 5 buckets keyed off name length (>28 / >22 / >16 / >12 / else) so common names display at the max size and longer ones step down progressively before triggering the truncate ellipsis.
- Names use `whitespace-nowrap truncate leading-tight min-w-0` (single-line with ellipsis, never wrap).

**TeamSummary** (`src/components/tournament/team-summary.tsx`) — three new optional props:
- `size?: "default" | "tv"` (default `"default"`). TV mode applies `text-2xl lg:text-3xl 2xl:text-4xl` title, larger YAxis tick (`fontSize: 20`, `fontWeight: 600`), larger LabelList (`fontSize: 24`, `fontWeight: 800`), wider YAxis (`width: 140`), thicker rows (`rowH: 56`). Drops the "เปรียบเทียบคะแนนระหว่างทีม" CardDescription on TV.
- `orientation?: "vertical" | "horizontal"` (default `"vertical"`). Default vertical = recharts default layout (XAxis category, YAxis number hidden, vertical bars, `LabelList position="top"`). Horizontal = `layout="vertical"`, XAxis hidden, YAxis category, `LabelList position="right"`.
- `fillParent?: boolean` (default `false`). Card root → `h-full flex flex-col`; CardHeader → `shrink-0`; CardContent → `flex-1 min-h-0 flex flex-col`; ChartContainer → `flex-1 min-h-0 aspect-auto` + inline `style={{ aspectRatio: "auto" }}` to suppress shadcn's default `aspect-video`. Required because the right TV column needs the chart to stretch to viewport height.

**Public dashboard `/t/[token]`** (`src/components/tournament/public/public-overview.tsx`) — overview tab body restructured into stacked Cards:
1. **คะแนนรวมทีม** — team-mode reads `computeStandings` directly; pair-mode aggregates pair StandingRows into team totals via inline `aggregatePairStandingsToTeams` helper (sums P/W/D/L/PF/PA, recomputes `leaguePoints` + `pointDiff`, sorts pts→diff→PF). Includes W-D-L column.
2. **คะแนนตามคู่ แยก Division** (pair mode only) — reads `tournament.pair_division_thresholds`; buckets pair standings by `computePairDivision(parsePairLevel(pair_level), thresholds)`; renders one card per Division 1..N in a `md:grid-cols-2` grid. When thresholds = [] → single "อันดับคู่" card.
3. **ตารางคิว** — in-progress rows highlighted; top-6 pending rows sorted by `queue_position ?? match_number`, TBD-only matches filtered out. Empty state "ยังไม่มีคิว".
4. **ผลล่าสุด** — top-5 completed (unchanged).

**Settings** (`src/lib/tournament/settings.ts` + `src/components/tournament/settings-manager.tsx`) — new section "การแสดงผล TV". All fields default-on / sensible defaults; old jsonb rows parse cleanly via `parseSettings` per-field fallback.

| Field                            | Type / Range                        | Default | Purpose                                                            |
| -------------------------------- | ----------------------------------- | ------- | ------------------------------------------------------------------ |
| `tv_show_team_chart`             | boolean                             | `true`  | Show right column TeamSummary chart                                |
| `tv_show_standings_carousel`     | boolean                             | `true`  | Show middle column standings carousel                              |
| `tv_show_upcoming`               | boolean                             | `true`  | Show left column upcoming carousel                                 |
| `tv_show_completed`              | boolean                             | `true`  | (dead — UI dropped, retained for forward compat)                   |
| `tv_show_fullscreen_button`      | boolean                             | `true`  | Show fullscreen icon button in header                              |
| `tv_show_bracket_link`           | boolean                             | `true`  | Show "ดูสาย" link (when KO matches exist)                          |
| `tv_completed_count`             | int 1–3                             | `1`     | (dead with completed section)                                      |
| `tv_standings_rows`              | int 0–50 (sentinel: `0` = ทั้งหมด)  | `6`     | Cap rows per Division standings page                               |
| `tv_standings_font_size`         | enum `sm` / `md` / `lg` / `xl`      | `md`    | Standings table font + name-column max-width                       |
| `tv_carousel_interval_sec`       | int 3–30                            | `8`     | Rotation interval for standings carousel                           |
| `tv_upcoming_interval_sec`       | int 3–30                            | `8`     | Rotation interval for upcoming carousel                            |
| `tv_refresh_interval_sec`        | int 30–300                          | `60`    | `<TvAutoRefresh intervalMs>` (page-level fallback refresh)         |

Settings UI in "การแสดงผล TV" Card is split into sub-groups: "ส่วนต่างๆ ของหน้า TV" (toggles), "จำนวนรายการ" (counts), "การหมุน / รีเฟรช" (intervals), + standalone "ขนาดฟอนต์" Select.

**Old settings removed** (this session):
- `tv_upcoming_count` — pending cap is now hardcoded `6`.

**Files touched**:
- New: `tv-fullscreen-button.tsx`, `tv-upcoming-carousel.tsx`, `bracket/page.tsx`.
- Modified: `tv/page.tsx`, `tv-standings-carousel.tsx`, `tv-match-card.tsx`, `team-summary.tsx`, `public-overview.tsx`, `settings-manager.tsx`, `settings.ts`.

### Code review fixes — P0/P1/P2 + dedup refactor (2026-05-22, commit `2f4b14c`)

22 files, +741/-410. Three buckets: correctness bugs, perf, and shared-primitive extraction.

**Correctness fixes**:
- `tournament-dashboard.tsx` W/D/L per-Division chart — each match now counted exactly once with ฝั่งชนะ / แพ้ / เสมอ labels (previously double-counted by iterating both sides).
- `tournament-dashboard.tsx` timeline — appended `"เกม X:Y"` + `"รวมแต้ม"` subtitle via existing `sumGameScores` helper.
- `tournament-dashboard.tsx` `formatHHmm` now uses `new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour, minute })` instead of `Date#toLocaleTimeString` — fixes Next 16 hydration mismatch when server TZ ≠ client TZ.
- `tournament-dashboard.tsx` `selectedDiv` reset `useEffect` — when `showTopDivTabs` flips false (e.g. user removes thresholds mid-session), forces `selectedDiv = "all"` so stale "Div 3" filter doesn't render an empty list.
- `tournament-dashboard.tsx` `matchesKey` — stable memo (`matches.length + completedCount + statuses join`) replaces the previous identity-only dep so memoized children only re-render on real data change.
- `tournament-dashboard.tsx` `parseSettings(t.settings)` now memoized once per render (was re-parsing inside two memos).
- `tournament-dashboard.tsx` court usage chart — court names normalized via `.trim()` before grouping (previously `"Court 1"` and `"Court 1 "` showed as 2 bars).
- `tv-upcoming-carousel.tsx` — dynamic `gridTemplateRows` to ensure every card occupies its slot; 6-row cap; `setInterval` paused via `visibilitychange` listener; `safeActive` clamps the read-time index when pages shrink between renders (skips an extra render cycle).
- `tv-fullscreen-button.tsx` — `requestFullscreen()`/`exitFullscreen()` wrapped in `try/catch` with `sonner` toast on failure (browsers without Fullscreen API permission throw).
- `tv-standings-carousel.tsx` — hex fallback color replaced with `var(--muted-foreground)` so dark mode + theme tokens are respected; standings limit now caps at 50 even when the setting is `0` ("ทั้งหมด").
- `settings.ts` `normalizeLegacy()` — added `Array.isArray()` guard before legacy-shape coercion (was throwing on the new array-shape thresholds during in-place migration).

**Perf fixes**:
- Dashboard is no longer the default landing tab — `tournament-tabs.tsx` defaults to `"teams"` and `public-tournament-shell.tsx` defaults to `"overview"`. Dashboard mounts only on explicit click (recharts bundle no longer loads on first visit).
- 3 pages (`tournaments/[id]/page.tsx`, `t/[token]/page.tsx`, `t/[token]/tv/page.tsx`) — `pairs` fetch now uses `team:teams!inner(tournament_id)` inner-join in the existing `Promise.all` first wave instead of a separate round-trip per page. Saves 1 RTT × 3 pages.
- TV page (`t/[token]/tv/page.tsx`) — `team_players` projection narrowed to `(id, display_name)` only (previously `*`).
- `tournament-live-wrapper.tsx` — `REFRESH_DEBOUNCE_MS` bumped 400 → 800.

**NEW shared modules** (consolidating inline copies):
- `src/lib/tournament/status.ts` — exports `TOURNAMENT_STATUS_LABEL` (`draft` → "ฉบับร่าง", `registering` → "รับสมัคร", `ongoing` → "กำลังแข่ง", `completed` → "จบแล้ว") + `TOURNAMENT_STATUS_BADGE` (Tailwind class map). Replaces 4–5 inline copies across `tournament-status-control.tsx`, `tournament-dashboard.tsx`, `public-hero.tsx`, `tv/page.tsx`, `bracket/page.tsx`.
- `src/components/tournament/tv-carousel-shell.tsx` — exports `useCarousel(pageCount, intervalMs)` hook + `<TvCarouselDots>` component; consumed by both `tv-standings-carousel.tsx` and `tv-upcoming-carousel.tsx`.
- `src/components/tournament/charts/orientable-bar.tsx` — exports `OrientableBarAxes` component + `orientableBarLayout(orientation)` helper; consumed by `team-summary.tsx` and all 4 Dashboard bar charts. Single source of truth for `vertical` vs `horizontal` recharts axis wiring.

**NEW helpers**:
- `src/lib/tournament/divisions.ts` — `parseTournamentThresholds(tournament)` + `buildPairDivisionMap(pairs, thresholds)`; dropped unused `divisionLabel` export.
- `src/lib/utils.ts` — shared `truncate(s, n=14)` helper (replaces inline truncation in 3+ chart label sites).
- `src/lib/actions/matches.ts` — private `getNextMatchNumber(sb, tournamentId, opts?)` consolidates 2 prior `select max(match_number)` call sites. Accepts `opts.precomputedMax?: number` to skip the DB query when caller already has the value (used by `generateKnockoutAction` to reuse `groupMax`).

### Collapsible Divisions + Guest restriction (2026-05-22, commit `05fe119`)

10 files, +180/-62.

**Collapsible per-division headers**:
- `pair-stage.tsx` + `knockout-stage.tsx` — each Division header (Div 1..N) is now a `<Collapsible>` trigger. `ChevronDown` icon rotates 180° when collapsed; count badge stays visible regardless of open/closed state. Default state: OPEN. Collapsing all divisions leaves N collapsed headers visible (so user can re-expand selectively).
- NEW `src/components/ui/collapsible.tsx` — shadcn-style wrapper around `@base-ui/react/collapsible` exporting `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`. Matches the existing Base UI pattern used by `Dialog`/`Popover`.

**Guest restriction** (3 enforcement layers):
- **Server action layer**: `createClubAction` (`src/lib/actions/clubs.ts`) + `createTournamentAction` (`src/lib/actions/tournaments.ts`) early-return `{ error: "ต้องเข้าสู่ระบบด้วย LINE เพื่อสร้าง..." }` when `session.isGuest === true`. Action-level guard prevents direct API bypass.
- **Server page layer**: `(app)/clubs/new/page.tsx` + `(app)/tournaments/new/page.tsx` `redirect("/login?auth_error=line_required&redirectTo=...")` for guest sessions before rendering form. Login page reads `auth_error` query param to surface the gate.
- **UI layer**: `(app)/clubs/page.tsx` + `(app)/tournaments/page.tsx` hide the "+ สร้าง..." CTAs for guests and render an amber notice "เข้าสู่ระบบด้วย LINE เพื่อสร้าง..." instead. `site-header.tsx` "+ สร้างก๊วน" header button is also hidden for guest sessions.

### P1 review fixes — BYE resolver + chart deps + co-admin guard + chart migration (2026-05-22, commit `d721beb`)

4 files, +114/-44. Closes the 7 P1 findings from the 2026-05-21 review.

- **`matches.ts` BYE cascading resolver** — replaced the 2-pass `for` loop with `while (walkoverable.length > 0)` capped at `Math.ceil(log2(bracketSize)) + 2` iterations. `iter === 0` is treated as the upper-bracket BYE pass; every iteration also sweeps the lower-bracket queue. Migrated both team-mode `insertAndResolveByes` (lines 460-542) and the pair-mode inline resolver (lines 716-829). Previously, deep brackets where one BYE chain triggered another could leave the second chain unresolved until the next score write.
- **`matches.ts` BYE writes loser slot=null** — when `m.loserNextMatchId && m.loserNextMatchSlot` are present, BYE auto-complete now also writes `loser_next_match.<slot>_id = null` so the downstream lower-bracket row's "single-null filter" catches it and triggers its own walkover when applicable.
- **`matches.ts` `getNextMatchNumber({ precomputedMax })`** — KO generate path now reuses the `groupMax` value it already queried (one fewer DB round-trip per KO generation).
- **`tournament-dashboard.tsx` `divisionChartData` deps** — added `divisionThresholds` to the `useMemo` deps so threshold edits mid-tournament correctly recompute the W/D/L per-Division chart.
- **`tournament-dashboard.tsx` `matchesKey`** — appends `games.length` + last-game scores (`games[games.length-1].a + ":" + .b`) so mid-match game edits refresh `pointTotals` in the timeline.
- **`admins.ts` `addCoAdminAction`** — fetches `profiles.is_guest` for the target user and rejects with `{ error: "ไม่สามารถเพิ่ม guest เป็น co-admin" }`. Closes the guest-via-coadmin loophole opened by the Phase 7b LINE-only co-admin assumption.
- **`tv-standings-carousel.tsx`** — `TvStandingsChart` migrated to `<OrientableBarAxes orientation="horizontal" categoryYWidth={72} tickFontSize={11} />` (was inline `XAxis`/`YAxis` — missed in the 2026-05-22 chart migration sweep).

### loading.tsx skeletons + Dashboard lazy-load (2026-05-22, commit `47e7a5e`)

12 files, +259/-4. App Router `loading.tsx` convention + `next/dynamic` code-split for the recharts-heavy Dashboard tab.

**Route-level skeletons** (7 files, each is a pure server component ≤31 LOC rendering an `animate-pulse` skeleton):
- `(app)/tournaments/loading.tsx` + `(app)/tournaments/[id]/loading.tsx`
- `(app)/clubs/loading.tsx` + `(app)/clubs/[id]/loading.tsx`
- `(public)/t/[token]/loading.tsx` + `(public)/t/[token]/tv/loading.tsx` + `(public)/t/[token]/bracket/loading.tsx`

**NEW shared primitives**:
- `src/components/ui/skeleton.tsx` — `Skeleton` + `SkeletonCard` (Tailwind-only, no extra deps).
- `src/components/tournament/tournament-dashboard-skeleton.tsx` — 4 summary cards + 2 top-performers cards + 2 chart cards + 1 court-usage card mirroring the real Dashboard layout so the swap-in is seamless.
- `src/components/tournament/tournament-dashboard-lazy.tsx` — `next/dynamic(() => import("./tournament-dashboard"), { ssr: false, loading: () => <TournamentDashboardSkeleton /> })`. Recharts (~150kb) only loads when the user opens the Dashboard tab.

**Wiring**:
- `(app)/tournaments/[id]/page.tsx` and `(public)/t/[token]/page.tsx` now mount `<TournamentDashboardLazy />` instead of `<TournamentDashboard />`. The granular skeleton renders during chunk fetch.

### Test infrastructure — vitest unit suite (2026-05-22, commit `4d53912`)

- `vitest` + `@vitest/coverage-v8` installed as devDependencies; `vitest.config.ts` at project root with `@` alias → `./src`, `environment: 'node'`, `globals: true`.
- npm scripts: `test` (`vitest run`), `test:watch`, `test:coverage`.
- 6 test files under `src/lib/tournament/__tests__/` covering pure functions only — **222 passing**:
  - `scoring.test.ts` — `gameWinner`, `leaguePoints`, `computeStandings` (sort order, tie-breaks, team + pair unit)
  - `scheduling.test.ts` — `balancedRoundRobin` (equal/unequal sides, 1v1/0v0 edge), `generateAllPairMatches`
  - `bracket.test.ts` — `buildBracket` (4/8/16 entries, `next_match_id` wiring), `nextPowerOf2`, `roundLabel`, `buildDoubleBracket` shape
  - `divisions.test.ts` — `computePairDivision` boundaries, empty/1-element/2-element thresholds, `divisionCount`, `divisionTone` cycling (the `divisionLabelTh` block was dropped 2026-06-14 when the helper moved to the i18n catalog)
  - `settings.test.ts` — `parseSettings({}) → DEFAULT_SETTINGS`, legacy `queue_bracket_preference` translation, invalid input fallback
  - `competitor.test.ts` — `teamToCompetitor`, `pairToCompetitor` name formation, `buildCompetitorMap` lookup
- Source files are not modified by tests (lib is read-only). Server-side / Supabase-touching modules (`audit.ts`, `permissions.ts`, `settings.server.ts`) excluded — would require mocking.

### Bug tracking — `bug.md` (2026-05-22, commits `4d53912`, `d721beb`)

- `bug.md` at project root is the single source of truth for known bugs. Two sections: `## Open` and `## Resolved`, newest entries on top of each section, grouped by dated subheading.
- Entry format: `**[P0|P1|P2] short title** — Context · Repro · Suspected cause · Suggested fix`.
- `CLAUDE.md` "Bug tracking" rule (added 2026-05-22) requires:
  - After every test run (unit / build / E2E / manual smoke), append findings to `## Open` under a dated subheading; if all pass, add a one-line confirmation under that date.
  - When a bug is fixed, move the entry to `## Resolved` with fix date + commit SHA + a `Fix:` line summarizing what changed.
  - If the fix changed any documented behavior, schema, label, or contract, sync `spec.md` too; if `spec.md` had a related "Known issues / Pending fix" entry, remove that entry there as well.
- Current state: **2 Open** (P2 tab label drift logged then fixed in this section + P2 duplicate "เพิ่มสมาชิก" `aria-label` for screen readers and automation). **8 Resolved** — 7 P1 review findings + 1 player-level-fill (verified as Playwright-only automation gap, not an app bug).

### Public mobile fit + tab persistence + shared hooks (2026-05-22, commits `fdd4c7a`..`ed7fc80`)

12 commits — public-page mobile-overflow hardening, shared `useTabSync` hook, `public-overview.tsx` deletion, dropped deprecated `pair_division_threshold` column.

**Mobile fit / overflow**:
- `src/app/(public)/layout.tsx` (or root layout `body`) — `overflow-x-clip` on body element to swallow any stray horizontal overflow (replaces the short-lived per-page `overflow-x-hidden` wrapper from commit `7da067c` which was reverted in P1 fix `294dafb`).
- `match-row.tsx` — name nodes use `min-w-0 truncate block`; separator + score nodes get `shrink-0`. Long pair names now ellipsis-truncate instead of pushing the row off-screen.
- `match-queue.tsx` — competitor row collapsed to a single `grid-cols-[1fr_auto_1fr]` at ALL breakpoints (previously stacked on `<sm`); tightened cell sizing (`w-10 sm:w-12`, `p-2 sm:p-2.5`, `text-xs sm:text-sm`).
- `tv-match-card.tsx` — header reordered: status pill on the left, `#N` + court badge on the right; competitor flex containers get `min-w-0` so truncate works inside flex.
- `team-summary.tsx` chart top margin — was bumped `4 → 24` in commit `dceba7b`, later made orientation-conditional in `ed7fc80` (vertical needs the headroom for `LabelList position="top"`; horizontal does not).

**Public `/t/[token]` tab simplification** (commit `091337a`):
- `ภาพรวม` tab removed from `PublicTournamentShell`; `public-overview.tsx` deleted entirely in P1 fix `294dafb`. Public shell tab union now `dashboard | groups | pairs | knockout | queue` (5 tabs).
- Knockout requirements checklist hidden from public viewers — `knockout-stage.tsx` shows empty state `ยังไม่ได้สร้างสายการแข่งขัน` when public viewer hits the empty KO state (commit `0aecce5`); admin-only checklist remains on `/tournaments/[id]`.
- `PublicTournamentShell` now wrapped in `<Suspense>` boundary on parent page (Next 16 App Router requirement when consuming `useSearchParams`).

**Shared primitives** (P2 sweep commits `dcd1311` + `777eecf` + `ed7fc80`):
- NEW `src/lib/hooks/use-tab-sync.ts` — shared `useTabSync<TabId>({ allTabs, validTabs, defaultTab })` hook returning `{ active, mounted, onChange }`. Reads `?tab=` via `useSearchParams`; writes via `router.replace(..., { scroll: false })`; strips invalid tabs from URL. `mounted: Set<TabId>` seeds with `defaultTab` so first paint is instant (no flash). Consumed by both `tournament-tabs.tsx` (admin shell) and `public-tournament-shell.tsx` (public shell). `useLayoutEffect` + ref guard prevents the param-strip effect from racing first render.
- NEW `src/components/tournament/public/public-tv-header.tsx` — shared TV-page header (logo + title + venue + status pill + fullscreen button + "ดูสาย"/"ออก TV" actions); consumed by `/t/[token]/tv` and `/t/[token]/bracket`. Removes duplicate inline header in `bracket/page.tsx`.

**Schema cleanup** (commit `777eecf`):
- migration `20260522000300_drop_pair_division_threshold_deprecated.sql` — drops the deprecated `tournaments.pair_division_threshold` (numeric, nullable) column. Only the array form `pair_division_thresholds` (numeric[]) remains. All code paths already used the array form; this migration is the cleanup pass.

### Full E2E smoke test (2026-05-22)

Comprehensive test pass against production Supabase using create-then-cleanup pattern:

1. **Unit** — `vitest run`: 222/222 pass.
2. **Typecheck** — `npx tsc --noEmit`: exit 0.
3. **Production build** — `next build`: 18 routes compiled, exit 0.
4. **E2E browser flow** via `playwright-cli` skill — created `E2E_TEST_<ts>` tournament (`group_knockout`, pair, thresholds `[5]`, 2 teams + 8 players + 4 pairs), generated pair matches, queue assignment + court + start, share token + public page + TV page.
5. **Cleanup** — all `E2E_TEST_*` rows deleted via Supabase MCP across `audit_logs`, `matches`, `pairs`, `team_players`, `group_teams`, `groups`, `teams`, `tournament_admins`, `tournaments`. Verified 0 rows remain; NOMKONZ TOUNAMENT #2 untouched.

Findings logged to `bug.md` (1 automation-only P1 since closed by manual verification, 2 P2 doc/UX items).

### Root-level loading UI + navigation progress bar (2026-05-24, commits `7910c99` + `069de0e`)

Two complementary loading layers added on top of the existing route-level `loading.tsx` skeletons (which remain unchanged):

**Shared spinner primitive**:
- NEW `src/components/ui/loading-spinner.tsx` — `<LoadingSpinner fullscreen? className? />` renders a **dual-ring pulse loader** (`<span className="loader">`, `.loader` + `@keyframes animloader` in `globals.css`) centered on a `min-h-screen` (fullscreen) or `min-h-[60vh]` container. Borders use `currentColor` (theme-aware via wrapper `text-muted-foreground`); `role="status"` + `aria-label`. (Replaced `Loader2 animate-spin` 2026-05-26.)

**Root-level Suspense fallback**:
- NEW `src/app/loading.tsx` — root App Router loading file; renders `<LoadingSpinner fullscreen />`. Catches first-load Suspense for routes that have no closer `loading.tsx`.
- `src/app/layout.tsx` — `{children}` wrapped in `<Suspense fallback={<LoadingSpinner fullscreen />}>` inside the `TooltipProvider`. Adds an outer streaming boundary above the implicit Next.js boundary mapped from `loading.tsx`.
- `src/app/(public)/t/[token]/page.tsx` — the previous `<Suspense fallback={null}>` around `PublicTournamentShell` was replaced with `<Suspense fallback={<LoadingSpinner />}>` (non-fullscreen — in-page boundary).

**Top progress bar** (`@bprogress/next` 3.x package):
- NEW `src/components/providers/progress-provider.tsx` — `"use client"` wrapper re-exporting `ProgressProvider` from `@bprogress/next/app` (aliased import; the package's exported name is `ProgressProvider`, NOT `AppProgressProvider`) with `height="3px"`, `color="var(--primary)"`, `options={{ showSpinner: false }}`, `shallowRouting`. Mounted in `src/app/layout.tsx` outside `TooltipProvider` so it sits above every page.
- Behavior: a 3px bar in the project's `--primary` `oklch()` color auto-tracks `<Link>` clicks and `router.push`/`router.replace` calls across the entire app; no per-page wiring needed.

**Tab change progress** (commit `069de0e`):
- `src/lib/hooks/use-tab-sync.ts` — `onChange` now wraps `router.replace` in `useTransition` and pairs it with manual `progress.start()` / `progress.stop()` calls via `useProgress()` from `@bprogress/next`. A `startedRef` ref pairs each `start()` with exactly one `stop()` when the transition's `isPending` flips back to `false`. This is needed because `router.replace({scroll:false})` to the same path is treated as shallow by the package's auto-tracker and otherwise would not trigger the bar; pairing it with React transition state ensures the bar shows for the full duration of the new tab's lazy-mount and Suspense resolution.

**Effect**: any nav click — sidebar link, tab switch, share-page link — shows the top bar; routes with their own `loading.tsx` (7 existing files in `(app)/`/`(public)/`) keep their skeletons; routes without a closer fallback get the root spinner.

---

## What's New Page (2026-06-21)

หน้าสาธารณะ `/whats-new` แสดง changelog ที่มนุษย์อ่านได้ (ภาษาไทย) ให้เจ้าของก๊วนและผู้ใช้ทุกคนเห็นว่าระบบมีอะไรอัปเดต

### Data module

- `src/lib/changelog.ts` — single source of truth; export `CHANGELOG: ChangelogEntry[]` (เรียงรุ่นใหม่บนสุด); types `ChangelogGroupType = "new" | "improved" | "fixed"`, `ChangelogEntry = { date, groups: { type, items }[] }`
- items เป็น **ข้อความไทย** (ถือเป็น data เหมือน audit_logs / LINE notifications — intentionally kept Thai)

### Page

- `src/app/(app)/whats-new/page.tsx` — server component (async); อยู่ใน `(app)` route group → ได้ SiteHeader อัตโนมัติ; **ไม่ต้อง auth gate** (ทุกคนดูได้)
- Layout: timeline + Card; vertical line + dot per entry; date format ผ่าน `date-fns` + `dateFnsLocaleOf(locale)` (locale จาก `getLocale()` server); กลุ่ม icon = Sparkles / Wrench / Bug; Badge ต่อกลุ่ม
- `max-w-2xl` จัดกลาง

### Navigation

- `user-menu.tsx` — เพิ่ม "มีอะไรใหม่" เป็น item สุดท้ายก่อน divider (icon: `Sparkles`, `t("nav.whatsNew")`) — เห็นเมื่อ logged-in
- `mobile-nav.tsx` — เพิ่มลิงก์ "มีอะไรใหม่" ใต้ "ทัวร์นาเมนต์" (เห็นทั้ง logged-in และ anonymous)

### i18n

- `nav.whatsNew` — th: `"มีอะไรใหม่"` / en: `"What's New"`
- `common.whatsNewTitle`, `common.whatsNewSubtitle`, `common.changelogNew`, `common.changelogImproved`, `common.changelogFixed`, `common.changelogFooter` — th + en ครบ

### วิธีเพิ่ม entry ใหม่

เพิ่ม object ที่ต้น `CHANGELOG` array ใน `src/lib/changelog.ts` — หน้าเว็บอัปเดตทันทีโดยไม่ต้องแก้ไฟล์อื่น
