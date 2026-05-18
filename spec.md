# Spec — ก๊วนแบด Tournament System

## Architecture

### Stack

- Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1
- Supabase Postgres (service role, bypass RLS) · MCP connected
- Auth: LINE Login + Guest (HMAC-signed `bc_session` cookie)

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

- `matches.division` column: `upper | lower | null`
- `tournaments.pair_division_threshold` — configurable per tournament (numeric, nullable)
  - `null` = no division; all pairs play together
  - `pair_level > threshold` → upper; else → lower
- Cross-division matches only in knockout

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
- `TournamentLiveWrapper` — Supabase Realtime `postgres_changes` (event `*`) on `matches` + `tournaments` → debounced `router.refresh()` (400ms trailing); green LIVE badge
- `share-controls.tsx` — QR Code button (icon-only, outline) beside copy/revoke when share link exists; opens Dialog with `react-qr-code` SVG (240x240, white bg) + URL below; `react-qr-code@2.0.21`

### Phase 7b — Co-admin + Audit Log

- **DB**: `tournament_admins` (PK: tournament_id + user_id (uuid → profiles.id), added_by (uuid → profiles.id), added_at) + `audit_logs` (id, tournament_id, actor_id, actor_name, event_type, entity_type, entity_id, description, created_at)
  - migration `tournament_admins_user_id_to_uuid`: backfilled LINE user_id text → profile UUID via `profiles.line_user_id` lookup; converted columns `user_id` + `added_by` `text → uuid` and added FK `→ profiles(id)` (user_id ON DELETE CASCADE; added_by ON DELETE SET NULL — column nullable)
- **Permission layer**: `src/lib/tournament/permissions.ts` — `assertIsOwner`, `assertCanEdit` (owner OR co-admin)
- **Audit helper**: `src/lib/tournament/audit.ts` — `writeAuditLog(params)` — inserts to `audit_logs` after every write
- **Co-admin actions**: `src/lib/actions/admins.ts` — `addCoAdminAction`, `removeCoAdminAction` (owner-only), `getCoAdminsAction`, `getAuditLogsAction` (owner + co-admin, limit 50)
- **All server actions updated**: `matches.ts`, `tournaments.ts`, `pairs.ts` — `assertCanEdit` for editable ops, `assertIsOwner` for share-token + structural changes
- **Co-admin UI**: `co-admin-controls.tsx` — owner-only Card; searchable Combobox (shadcn `Popover` + `Command`) to find profiles by `display_name`; list + remove
  - Server search: `searchProfilesAction(tournamentId, query)` — owner-gated, ILIKE on display_name, excludes self + existing co-admins + profiles without `line_user_id`; limit 20
  - Debounced 250ms client-side; `shouldFilter={false}` (server filters)
  - `CommandList` keeps a stable structure (one `CommandEmpty` with dynamic text + one `CommandGroup`) — cmdk requires this; mixing multiple conditional `CommandEmpty`/raw elements breaks its child diffing
  - On submit, passes selected profile's `line_user_id` to `addCoAdminAction` (which still validates LINE format + resolves to profile UUID)
- **Audit log UI**: `audit-log-panel.tsx` — collapsible Card; fetches on first open; newest-first list
- **Page**: `canEdit = isOwner || isCoAdmin` — `TournamentStatusControl` + all edit components use `canEdit`; owner-only: `ShareControls` + `CoAdminControls`

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
| Update tournament settings  | ✓       | ✗         |
| View audit log              | ✓       | ✓         |

### Manual Match Creation (pair mode)

- **Action**: `createManualMatchAction({ tournamentId, pairAId, pairBId })` in `matches.ts`
  - Validates same division (computed from `pair_level` vs `pair_division_threshold`)
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

### UI Improvements

- Tournament detail page split into tabs: **ทีม · กลุ่ม* · คู่* · Knockout\* · ตั้งค่า** (\* conditional per format)
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
  - `NEXT_PUBLIC_GIT_COMMIT` — `execSync("git rev-parse --short HEAD")` with `try/catch` → `"unknown"` fallback (shallow CI clones)
- **UI**: `SiteHeader` shows outline `Badge` next to 🏸 ก๊วนแบด logo with `v{version} ({commit})` — `hidden sm:inline-flex` (mobile-hidden)

### Public Share Page Redesign (`/t/[token]`)

- **Layout**: hero banner + notes banner + tabs (ภาพรวม / กลุ่ม / คู่ / สาย)
- **`PublicHero`** (`src/components/tournament/public/public-hero.tsx`) — server component:
  - Gradient card: `from-amber-50 via-background to-orange-50` + 1px gold accent stripe + decorative bg trophy
  - Title row: amber Trophy icon + tournament name + TV button (secondary)
  - Status pill (custom colors per status) + venue + date meta row
  - Stat grid 2×2 → 4-col: รูปแบบ / ทีม / คู่แข่ง / การแข่งขัน (`completed/total`)
  - Action row: `ExportButtons` + "ดูสาย" bracket link (conditional)
- **`PublicOverview`** (`src/components/tournament/public/public-overview.tsx`) — server component:
  - In-progress card: `ring-2 ring-green-500/30` + pulsing dot + `MatchRow` list
  - 2-col grid (lg): standings mini-table (top 6, played > 0) + recent results (last 5)
  - Empty states: no matches / waiting to start
- **`PublicTournamentShell`** (`src/components/tournament/public/public-tournament-shell.tsx`) — client component:
  - `Tabs variant="line"` with border-b underline style
  - Tabs: ภาพรวม (always) · กลุ่ม · คู่ · สาย (conditional on format/unit)
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

| Action                   | Owner | Co-Admin | Player |
| ------------------------ | ----- | -------- | ------ |
| เช็คอิน / Kick / Reorder | ✓     | ✓        | ✗      |
| Edit club / Expenses     | ✓     | ✗        | ✗      |
| Add/remove co-admins     | ✓     | ✗        | ✗      |

### Co-Admin

- **DB**: `club_admins` — PK `(club_id, user_id)`; FK `club_admins_club_id_fkey → clubs ON DELETE CASCADE`; FK `club_admins_user_id_fkey → profiles ON DELETE CASCADE`; `added_by` nullable FK → profiles ON DELETE SET NULL
- **Actions**:
  - `addClubCoAdminAction(clubId, lineUserId)` — owner only; LINE ID regex validate → resolve UUID via `profiles.line_user_id`; duplicate → error 23505
  - `removeClubCoAdminAction(clubId, userId)` — owner only; checks delete error
  - `searchClubProfilesAction(clubId, query)` — owner only; min 2 chars; ILIKE escape (`%`, `_`, `\`); excludes owner + existing co-admins + null `line_user_id`; limit 20; `excludeIds` always non-empty (has `session.profileId`)
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

- **DB**: `club_expenses` — `id, club_id (FK → clubs CASCADE), label text, amount numeric(10,2), created_at`
- **Actions** (owner only): `addExpenseAction`, `updateExpenseAction`, `deleteExpenseAction`; `ClubExpense` type exported; `setTotalCostAction` ยังคงไว้ (legacy)
- **`ExpenseManager`** (`src/components/club/expense-manager.tsx`) — client:
  - Shared `ExpenseForm` (TanStack Form + `z.number()`) สำหรับทั้ง add และ edit
  - Hover-reveal edit/delete buttons; aria-label ครบ
  - Total = `expenses.reduce`; per-person = `Math.ceil(total / playerCount)`
  - `router.refresh()` หลัง mutate
- **Club detail page**: fetch parallel; per-person ใน info grid; fallback `total_cost` (legacy) ถ้า expenses ว่าง

### Color Summary (Group Stage)

- **Component**: `ColorSummary` + `buildColorSummary` ใน `src/components/tournament/group-stage.tsx`
- แสดงก่อน standings grid เมื่อ `completedMatches > 0` และ `hasGroups`
- `buildColorSummary(groups, teams)` — aggregate `leaguePoints` ต่อ `team.color` cross-group; sort desc; `useMemo`
- **Cards grid** `grid-cols-2 sm:grid-cols-4` — แต่ละสี: color ring (`--tw-ring-color` CSS variable) + pts + ชื่อทีม (truncate)
- **Bar chart** — horizontal bars ความกว้างตาม `pts/maxPts`; `Card`/`CardContent`; `transition-[width] duration-500`

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
| `court_strict`                     | `true`  | UI hint only — DB partial unique index `uniq_matches_inprogress_court` always enforces. Flag exists for future loosening                                      |
| `color_summary`                    | `true`  | `GroupStage` prop `showColorSummary`; owner page + `/t/[token]`                                                                                               |
| `export_visible`                   | `true`  | Owner Settings tab wraps `ExportButtons`; `PublicHero` prop `showExport`                                                                                      |
| `allow_force_bracket_reset`        | `false` | `resetMatchScoreAction` — bypasses "next match completed" guard for upper + lower                                                                             |
| `allow_manual_match_after_bracket` | `true`  | `createManualMatchAction` — rejects when `false` AND knockout matches exist                                                                                   |
| `auto_advance_next`                | `false` | `recordMatchScoreAction` post-RPC — picks first pending by `queue_position`, sets `in_progress` + inherits `court`; 23505 on court collision silently skipped |
| `realtime_enabled`                 | `true`  | `TournamentLiveWrapper` prop `realtimeEnabled`; skips Supabase subscribe                                                                                      |
| `audit_log_enabled`                | `true`  | `writeAuditLog` fetches settings + early-returns when `false` (1 extra column read per write — acceptable for the current write volume)                       |
| `match_cooldown_minutes` (0-30)    | `0`     | `startMatchAction` reads latest `audit_logs` row with `event_type='match_started'` for this tournament; rejects if `now - created_at < cooldown`              |

**Cut from Phase 11**: `require_checkin` — needs new `team_players.checked_in_at` column + check-in flow → Phase 12.

### Notifier helper

- `src/lib/notification/line.ts` — new `notifyTournamentEvent(tournamentId, event, text)` reads settings + short-circuits when `line_notify[event] === false`, otherwise delegates to `notifyTournamentAdmins`
- All 5 previous call sites swapped (`notifyTournamentAdmins` → `notifyTournamentEvent` + event key)

### UI

- **`SettingsManager`** (`src/components/tournament/settings-manager.tsx`) — owner-only Card, mounted in Settings tab between `CoAdminControls` and `EditTournamentForm`
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

- **`court_strict`**: flag is currently UI-only. DB index always enforces single-occupancy. Tooltip documents this. Future: drop the unique index to let the flag truly toggle behavior (trade DB integrity for UX flexibility — not done in Phase 11).
- **`audit_log_enabled`**: caller pays one extra read per write. Acceptable now; cache later if write volume grows.
- **`auto_advance_next`**: no LINE notify on the auto-promoted match (different code path); add later if needed.
- **`allow_force_bracket_reset`**: single-level cascade only — resets `next_match` / `loser_next_match` one hop. If that row's downstream rounds are also completed, a second manual reset is required. A recursive cascade would need a Postgres RPC.

### Phase 11 review fixes (2026-05-17)

- **A — auto_advance TBD filter**: `recordMatchScoreAction` auto-advance previously picked any pending match by `queue_position`. KO matches awaiting a prior round's winner have `team_a_id=null` or `pair_a_id=null` and were getting promoted to in_progress with `— vs Team B` shown in UI. Fix: pull a 20-row queue window, filter in JS for fully-populated competitor slots (`(pair_a && pair_b) OR (team_a && team_b)`), promote the first one. Supabase JS filter cannot express the OR-pair, hence the JS pass.
- **B — cooldown source decoupled from audit_log**: `match_cooldown_minutes` previously read `audit_logs` rows with `event_type='match_started'`. When `audit_log_enabled=false`, no row was written, so cooldown silently never triggered. Fix: new column `matches.started_at timestamptz` (migration `add_matches_started_at`); set in `startMatchAction` + `auto_advance_next`; cooldown reads `matches.started_at` desc. Backfill ran `UPDATE matches SET started_at=NOW() WHERE status='in_progress'` so pre-existing in-progress rows count.
- **D — parseSettings per-field fallback**: schema-level `safeParse` previously dropped every valid field if one was invalid (e.g. manual DB edit corrupting a single key). Fix: try whole-object parse first (fast path); on failure, walk `TournamentSettingsSchema.shape`, run `safeParse` per field, keep the parsed value if it succeeds, fall back to `DEFAULT_SETTINGS` per key.

## Todo

- Phase 12 — `require_checkin` flag + `team_players.checked_in_at` + UI check-in flow

### Phase 13 — Competition mode (multi-class, team-aware grouping)

**Context.** `tournaments.mode = "competition"` is currently dormant — every new tournament is hard-coded to `"sports_day"` and no code path branches on `mode`. Real Thai pair tournaments (see วีนฉ่ำ Excel reference) require structure the current `sports_day` flow cannot express: classes (NB/BG/N/S/P-), per-class capacity, team-aware group assignment, and per-class brackets — all sharing one tournament's courts + queue. This Phase opens the `competition` mode and adds the missing primitives.

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

### From real-world reference (วีนฉ่ำ #2 xlsx)

Excel `/Users/x/Desktop/กำหนดการแข่งขันและผลคะแนน รายการวีนฉ่ำ ครั้งที่ 2.xlsx` (130 pairs, 5 classes NB/BG/N/S/P-, 6 courts, sheets: รายชื่อรวม/กติกา/ตารางเวลา/RunMatch/Class _/KO-_/สรุปรายการรางวัล) — patterns to adopt:

**Quick wins** (small effort, do anytime):

- **BYE preset score** — `insertAndResolveByes` currently inserts `games: []`. Set `games: [{a:21,b:15},{a:21,b:15}]` (winner side) so standings tiebreak (point diff / points-for) reflects real walkover convention. Fix in `src/lib/actions/matches.ts`.
- **Fixed-2-game group format** — add `settings.group_match_format: "fixed_2" | "best_of_3" | "best_of_5"` (default `best_of_3`). Branch in `gameWinner` so `fixed_2` returns `"a"|"b"|"draw"` based on 2-game outcome; `ScoreForm` clamps to 2 rows when active. Common in Thai pair tournaments.
- **Pair CODE auto-gen** — add `pairs.code text` (nullable). After `generateGroupsAction` for pair mode, assign `<class_code><group_letter><seed>` (e.g. `NBA1`). Display in queue / bracket / TV / CSV export. Sortable + speakable for organizers ("คู่ NBA1 มาคอร์ท 3").

**Medium features**:

- **Time-slot schedule grid** — currently we have queue order but no real timestamps. Add `tournaments.start_time time`, `tournaments.slot_minutes int default 30`. Auto-fill `matches.scheduled_at` during auto-rotate: `start_time + floor((queue_position-1) / court_count) * slot_minutes`. New page `/tournaments/[id]/schedule` renders HTML table time × court grid; A4 landscape print-optimized. Organizers will print and pin at venue.
- **Per-court referee view** — `/t/[token]/court/[n]` — filters matches by `court=n`, shows in_progress + 2 next pending. Designed for referee phone. Auto-refresh + minimal UI.
- **Prize summary page** — new field `tournaments.prize_template jsonb` = `[{rank:1, label:"ชนะเลิศ", cash:10000, trophy:true}, …]` per tournament. Page `/tournaments/[id]/prizes` auto-computes champion + runner-up + semifinalists from KO bracket per class. Print-friendly for award ceremony.

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

- **Round-robin score matrix view** — each pair row shows score (Set 1 / Set 2) vs the other 3 pairs in the group, in one compact grid (4×3 cells). Organizers read entire group standings in one glance vs scrolling a match list. **TODO**: add toggle "Matrix" button on each `GroupCard` next to existing match list — render 4×4 matrix (diagonal = self, off-diagonal = score vs that opponent).
- **My matches view (R1/R2/R3 column)** — each pair sees the 3 match_numbers it plays in that group. Lets a player look up "when do I play next" without scanning queue. **TODO**: add `/t/[token]/pair/[code]` page (also `/team/[id]`) — shows all matches for this pair/team with court + scheduled_at + opponent. Linked from standings row "ดูแมตช์".
- **Tiebreak criteria printed next to table** — every class sheet repeats "คะแนนผล → ผลต่างแต้ม → H2H → จับฉลาก". Standings table here hides this. **TODO**: tooltip on `Pts` column header in `StandingsTable` + footer line beneath standings ("เกณฑ์: pts → diff → points-for → H2H").
- **Group size enforcement (4 pairs/group fixed)** — Excel always uses 4. Current `groupCount` slider auto-distributes, but uneven groups (e.g. 14 pairs ÷ 3 groups = 5+5+4) common in real events. Already supported; document recommended group size = 4 in tooltip.
- **Advance rule supports "best of Nth place"** — NB rule: top 2 + best 4 third-placed teams across all groups → KO 16. Currently `advance_count` = top N per group only. **TODO** (Phase 12+): new field `tournaments.advance_rule jsonb` shape `{ top_per_group: 2, plus_best_nth: { rank: 3, count: 4 } }`. `seedsFromStandings` reads this and aggregates the best-of-rank pool across groups using existing tiebreak.
- **Sequential CODE per class** (NB1..NB24) is separate from master CODE (NBA1..NBF4). Skip — adopting master CODE alone is enough.

- **Queue bracket preference (knockout double-elim)**: เมื่อจัดคิว/auto-rotate ในทัวร์นาเมนต์ที่มีสายบน+สายล่าง, ให้ owner ตั้งค่าได้ว่า "สายบนแข่งก่อน" / "สายล่างแข่งก่อน" / interleaved. เก็บที่ `tournaments.queue_bracket_preference` (`upper_first` | `lower_first` | `interleaved`, default `interleaved`); ใช้ใน `autoRotateQueueAction` (sort key) + section labels ใน MatchQueue UI
- **Court Select placeholder bug**: ใน `match-queue.tsx` row, SelectTrigger ของช่อง "สนาม" แสดงค่าดิบ `__none` ใช้คำว่า "ว่าง" แทนค่าดิบ เมื่อยังไม่เลือกสนาม (`court === ""`). สาเหตุ: SelectValue ไม่ resolve label จาก SelectItem ที่ value `__none`. Fix: ใช้ `SelectValue placeholder="—"` + value `undefined` แทน sentinel (ไม่ select item), หรือ render label ผ่าน children function ของ SelectValue
