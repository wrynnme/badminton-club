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
- Atomic multi-row writes go through Postgres RPCs (single transaction): `record_match_score`, `replace_tournament_matches`, `regenerate_tournament_groups` — granted to `service_role` only

---

## Current State

### Pair System (flat schema)

`pairs` table: `id, team_id, player_id_1, player_id_2, display_pair_name, pair_level, created_at`

- `pair_level` — auto-computed: `player1.level + player2.level` (sum, numeric) — no manual input
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
  team: string;        // informational only
  pair_id: string;     // optional — UUID for upsert; empty = new pair
  id_player_1: string; // required — csv_id of player 1
  id_player_2: string; // required — csv_id of player 2
  pair_name: string;   // optional
  // pair_level omitted — auto-computed from player levels (sum)
}
```

### `PlayerCsvRow`

```ts
{
  team: string;         // required
  color: string;        // optional
  csv_id: string;       // required — stable upsert key (id_player column)
  display_name: string; // required
  role: "captain" | "member";
  level: string;        // optional
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

| Action | isOwner | isCoAdmin |
|---|---|---|
| Record/reset scores | ✓ | ✓ |
| Add/edit/remove players | ✓ | ✓ |
| Manage teams/groups/bracket | ✓ | ✓ |
| Change tournament status | ✓ | ✓ |
| CSV export | ✓ | ✓ |
| Create/revoke share link | ✓ | ✗ |
| Add/remove co-admins | ✓ | ✗ |
| Update tournament settings | ✓ | ✗ |
| View audit log | ✓ | ✓ |

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

- Tournament detail page split into tabs: **ทีม · กลุ่ม* · คู่* · Knockout* · ตั้งค่า** (* conditional per format)
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

| Action | Owner | Co-Admin | Player |
|---|---|---|---|
| เช็คอิน / Kick / Reorder | ✓ | ✓ | ✗ |
| Edit club / Expenses | ✓ | ✗ | ✗ |
| Add/remove co-admins | ✓ | ✗ | ✗ |

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
  - 3 sections: รอแข่ง (`pending`, draggable when `canEdit`) · กำลังแข่ง (`in_progress`) · จบแล้ว (`completed`)
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

## Todo

- Phase 10 — (TBD)
