# Spec — ก๊วนแบด Tournament System

## Architecture

### Stack

- Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1
- Supabase Postgres (service role, bypass RLS) · MCP connected
- Auth: LINE Login + Guest (HMAC-signed `bc_session` cookie)
- Theme: **"Court Energy" (D2) — court-green primary + green-tinted neutral + vivid orange `--brand`** (design-language overhaul 2026-05-30, replaced Teal+Zinc). Picked from a 3-direction compare (`design-preview.html`, throwaway artifact at repo root). Applied via CSS vars in `src/app/globals.css` `:root`/`.dark` only. Light primary/ring = `oklch(0.52 0.16 150)`, dark = `oklch(0.78 0.2 148)`; neutrals green-tinted (hue ~150–158, not Zinc); `--accent` stays a **subtle neutral** (shadcn hover/selected role — NOT the brand orange). Charts = green-family ramp.
  - **Semantic tokens** (theme-aware — light/dark baked into the var, so no `dark:` at call sites): `--success` `--warning` `--live` `--winner` `--brand` `--destructive`. Division palette `--div-1..8` (1=top). Elevation ladder `--e-1..3` + `--glow` (consume via `var()`), `--shadow-color` HSL triplet. All new colors registered in `@theme inline` so `bg-success`/`text-winner`/`bg-div-1/14` utilities + opacity modifiers exist.
  - **Display font** Chakra Petch via `next/font` (`--font-chakra` → `@theme --font-heading`); body still Anuphan, mono Geist Mono. `font-heading` utility is **inert until phase-2 components adopt it** (headings/scoreboard numerals).
  - **Phase 1 done (token foundation, 5 files)**: `globals.css`, `layout.tsx`, `result-display.ts` (RESULT_TEXT/PILL → winner/destructive/warning tokens), `divisions.ts` (DIVISION_COLORS → literal `border-div-N/40 bg-div-N/14 text-div-N` strings — Tailwind v4 needs literals), `public-hero.tsx` (gradient + status pills + trophy → tokens). Token swap re-skins the whole app automatically; verified tsc-clean + light/dark/mobile render on `/t/[token]`.
  - **Phase 2 pending (component restyle to the bold scoreboard look)**: big numerals (`font-heading`), live glow/pulse on "กำลังแข่ง", canonical status-pill unification (match-queue.tsx + tv-match-card.tsx still inline ad-hoc amber/green/zinc), and the dashboard stat-card mobile overflow at ≤390px. Lands mostly in files currently overlapping the uncommitted pair-schedule work — commit that first.

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
- Helpers: `computePairDivision(level, thresholds[])`, `divisionLabelTh(n)`, `divisionTone(n)`, `divisionCount(thresholds)`, `DIVISION_COLORS` — `src/lib/tournament/divisions.ts`

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
- `TournamentLiveWrapper` — Supabase Realtime `postgres_changes` (event `*`) on `matches` + `tournaments` → debounced `router.refresh()` (800ms trailing, was 400ms; bumped 2026-05-22 to coalesce more rapid score writes); green LIVE badge
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
  - `NEXT_PUBLIC_GIT_COMMIT` — `execSync("git rev-parse --short HEAD")` with `try/catch` → `"unknown"` fallback (shallow CI clones)
- **UI**: `SiteHeader` shows outline `Badge` next to 🏸 ก๊วนแบด logo with `v{version} ({commit})` — `hidden sm:inline-flex` (mobile-hidden)

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
- **D — parseSettings per-field fallback**: schema-level `safeParse` previously dropped every valid field if one was invalid (e.g. manual DB edit corrupting a single key). Fix: try whole-object parse first (fast path); on failure, walk `TournamentSettingsSchema.shape`, run `safeParse` per field, keep the parsed value if it succeeds, fall back to `DEFAULT_SETTINGS` per key.

## Todo

(Phase 12 DONE — see below.)

### UX polish backlog

- **`cursor: pointer` ทุก clickable** — ✅ DONE 2026-05-25. `cursor-pointer` ใส่ที่ `buttonVariants` base (`ui/button.tsx`) → คุม `<Button>` ทั้ง app; เพิ่มที่ `ui/tabs.tsx` (TabsTrigger), `ui/select.tsx` (SelectTrigger), `ui/checkbox.tsx`, และ raw color-swatch `<button>` ใน `team-manager.tsx`. DnD drag handles ใช้ `cursor-grab active:cursor-grabbing` อยู่แล้ว (ถูกต้อง); `SelectItem`/`CommandItem` คง `cursor-default` ตาม base-ui listbox convention. tsc clean.
- **i18n ไทย/อังกฤษ** — ทั้งหมดของ UI strings ตอนนี้ hard-coded เป็นภาษาไทย. เพิ่ม locale switcher (TH/EN) ใน SiteHeader.
  - แนวทาง: `next-intl` หรือ `next-international` (server-component friendly สำหรับ Next 16 App Router) — เลือกตัวที่ static-export-safe.
  - File structure: `src/locales/th.json` + `src/locales/en.json` แยก keys ตาม namespace (`common`, `tournament`, `match`, `stats`, `settings`, `audit_events`, `errors`).
  - Locale cookie + `<html lang="th|en">` set จาก server-side cookie read (mirror theme cookie pattern).
  - Server actions error strings ก็ต้อง translate — return error keys (`err.unchecked_count`) แทน Thai literal และ resolve ที่ client toast handler.
  - Audit log descriptions — choice point: เก็บใน DB เป็น Thai (current) หรือเป็น i18n key + params? Simpler: keep Thai in DB, translate per-locale only at display time.
  - LINE notify messages — locale per tournament setting (`settings.notify_locale: "th" | "en"`).
  - Date/number formatting → `Intl.DateTimeFormat` + `Intl.NumberFormat` ทุกที่ (ตอนนี้ใช้บางที่แล้ว).
  - Effort estimate: ~12-16 ชม. (extract + key all strings + locale plumbing + LINE/audit decisions + smoke test).

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

**Medium features**:

- **Per-court referee view** — `/t/[token]/court/[n]` — DONE (2026-05-24). New public page; `[n]` = URL-encoded court name (free text, decoded via `decodeURIComponent`). Filters matches by `court=courtName`; shows all in_progress (large card) + top 2 pending sorted by `queue_position ?? match_number` (normal card). LIVE badge when in_progress present. Empty state when no matches. Auto-refresh: `TournamentLiveWrapper` (Supabase Realtime, respects `realtime_enabled`) + `TvAutoRefresh` (30s polling fallback). Phone-first layout: `max-w-xl mx-auto px-4 py-6`. Elapsed time (mm:ss) computed server-side from `started_at`. No admin controls. Single new file: `src/app/(public)/t/[token]/court/[n]/page.tsx`.
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
  - `divisions.test.ts` — `computePairDivision` boundaries, empty/1-element/2-element thresholds, `divisionLabelTh`, `divisionCount`, `divisionTone` cycling
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
