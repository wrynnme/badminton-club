@AGENTS.md
@spec.md

# Project: ก๊วนแบด (Badminton Club)

## Stack

- Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1
- Supabase (Postgres + RLS) — MCP connected via `.mcp.json`
- Auth: LINE Login + Guest mode (HMAC-signed cookie, no Supabase Auth)
- Font: Google Font Anuphan (`thai` + `latin` subsets)

## After completing any task

1. Update `spec.md` — current state, decisions made, what's next
2. Update data contracts if any interface changed
3. Never claim "done" without updating `spec.md` first

## กฏการพัฒนา (สำคัญ)

- **Forms**: ใช้ TanStack Form ทุกอัน — `useForm` + `form.Field` + `form.Subscribe`
- **UI**: shadcn/ui components เท่านั้น — ห้ามเขียน raw `<input>` / `<button>` เปล่า
- **Server actions**: รับ plain typed object (ไม่ใช่ FormData) — export type ไว้ใน `clubs.ts`
- **Validation**: client-side ใน TanStack validators + server-side ใน zod (ทำทั้ง 2 ชั้น)
- **DB writes**: ทำผ่าน server actions ด้วย service role key (bypass RLS)

## Key conventions

- Supabase key env var is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not ANON_KEY)
- DB column for club cost is `total_cost` (not `cost_per_person`) — set by owner after game ends
- `club_players` has `position` column for drag-and-drop ordering
- Writes go through server actions using `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- Session stored in `bc_session` cookie (see `src/lib/auth/session.ts`)
- Auth redirects: use `?redirectTo=/path` on login page; LINE OAuth stores it in `line_redirect_to` cookie
- `loginRedirect()` in `clubs.ts` uses `referer` header to auto-populate `redirectTo`
- Player list auto-refreshes via `router.refresh()` every 30s; manual refresh button included
- `SortablePlayerList` uses `@dnd-kit` with `activationConstraint: { distance: 8 }` for mobile compat
- Theme stored in `theme` cookie — `layout.tsx` reads it server-side to add `dark` class on `<html>` (no next-themes)

## Tournament System (Phase 0–4 done)

### Architecture

- `src/lib/tournament/competitor.ts` — `Competitor` type abstracts over `Team` and `Pair`; `buildCompetitorMap`, `teamToCompetitor`, `pairToCompetitor`
- `src/lib/tournament/scheduling.ts` — `balancedRoundRobin(sizeA, sizeB)` rotates sideB each round; `generateAllPairMatches(teamPairs)` produces every inter-team pair matchup
- `src/lib/tournament/scoring.ts` — `computeStandings(matches, unit, ids)` returns `StandingRow[]`; `gameWinner(games)`, `leaguePoints(wins, draws)`; Win=3, Draw=1, Loss=0
- `src/lib/tournament/bracket.ts` — `buildBracket(entries)` generates single-elimination bracket with pre-assigned UUIDs + `next_match_id` links; `buildDoubleBracket(entries)` for full double-elimination; `nextPowerOf2(n)`, `roundLabel`, `lowerRoundLabel`
- `src/lib/export/csv.ts` — `generateMatchesCsv`, `generateRosterCsv`, `generatePlayerImportTemplate`, `generatePairImportTemplate`, `downloadCsv`

### Schema tables

- `tournaments` — id, owner_id, name, mode (`sports_day`|`competition`), status, format, match_unit (`team`|`pair`), has_lower_bracket, allow_drop_to_lower (default false), seeding_method (`random`|`by_group_score`), advance_count (default 2), team_count, scoring_rules jsonb
- `teams` — id, tournament_id, name, color, seed
- `team_players` — id, team_id, profile_id?, display_name, role (`captain`|`member`), level text, csv_id text, created_at
- `groups` — id, tournament_id, name
- `group_teams` — group_id, team_id, position, wins, draws, losses, points_for, points_against
- `pairs` — id, team_id, player_id_1 (FK team_players), player_id_2 (FK team_players), display_pair_name (optional), created_at
- `matches` — id, tournament_id, round_type (`group`|`knockout`), round_number, match_number, team_a_id, team_b_id, pair_a_id, pair_b_id, games jsonb (`[{a,b}]`), winner_id, status, next_match_id (self-ref), next_match_slot (`a`|`b`), loser_next_match_id (self-ref), loser_next_match_slot (`a`|`b`), bracket (`upper`|`lower`|`grand_final`), court?, scheduled_at?

### Server actions

- `src/lib/actions/tournaments.ts` — `createTournamentAction`, `updateTournamentStatusAction`, `addTeamPlayerAction` (incl. level), `updateTeamPlayerAction({display_name?, level?})`, `importPlayersCsvAction(tournamentId, PlayerCsvRow[])`, `importPairsCsvAction(tournamentId, PairCsvRow[])`
- `src/lib/actions/matches.ts` — `generateGroupsAction`, `generateGroupMatchesAction`, `generatePairMatchesAction`, `generateKnockoutAction`, `recordMatchScoreAction({ matchId, tournamentId, games })`, `resetMatchScoreAction`
- `src/lib/actions/pairs.ts` — `createPairAction({ teamId, playerIds: [id1,id2], name? })` inserts `player_id_1`/`player_id_2` directly; checks duplicates via OR query; `deletePairAction`

### Components

- `team-manager.tsx` — add teams + members (level preset S/A/B/C/D/N); captain listed first; inline rename + level edit via `PlayerRow`
- `group-stage.tsx` — gen groups (configurable count), gen matches, `GroupCard` per group with `StandingsTable` + `MatchRow`
- `pair-stage.tsx` — `PairManager` grid (per team) + generate pair matches + dual standings (team aggregate + per-pair)
- `pair-manager.tsx` — toggle-select 2 players (with level badge); flat pair create/delete; shows player1/player2 names + levels
- `knockout-stage.tsx` — gen bracket (advance_count per group or all teams); renders upper/lower/grand_final sections; BYE auto-advance; champion banner
- `tournament-status-control.tsx` — owner changes status (draft → registering → ongoing → completed)
- `csv-import-dialog.tsx` — 2-tab: step 1 players (upsert by csv_id), step 2 pairs (lookup by csv_id); preview tables; download templates
- `export-buttons.tsx` — Export: ผลแข่งขัน · รายชื่อ + Template: ผู้เล่น · จับคู่ (pre-filled with id_players)
- `match-row.tsx` — shows competitor names + game score (e.g. "2:0") + point totals; "TBD" for unassigned bracket slots; reset (↺) or "กรอกผล"
- `score-form.tsx` — games array UI (add/remove rows of score A : score B)
- `standings-table.tsx` — P/W/D/L/+−/Pts; Trophy icon for leader; shows pair subtitle (player names)

### Pages

- `/tournaments` — list
- `/tournaments/new` — create form (mode, format, match_unit, advance_count, team_count …)
- `/tournaments/[id]` — detail + TeamManager + GroupStage or PairStage + KnockoutStage + ExportButtons

### Scoring rules

- Win = 3 league pts, Draw = 1 pt, Loss = 0 pts
- Match winner determined by games won (e.g. 2:0 or 2:1 out of best-of-3)
- Tie-break: point diff → points for

### Pair system (flat schema)

- `pairs` stores `player_id_1` and `player_id_2` directly — no junction table
- 1-person-1-pair enforced at app level: `createPairAction` queries existing pairs with OR on both slots
- `pairToCompetitor` builds name from `player1.display_name / player2.display_name`
- Query pairs with players: `select("*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)")`

### CSV Import (2-step)

- **Step 1 — players**: `team, color, id_player, display_name, role, level`
  - `csv_id` = `id_player` stored on `team_players` — stable lookup key
  - Upsert: same csv_id → update display_name/role/level; new csv_id → insert
  - Auto-creates teams if name missing; preset colors if color not specified
- **Step 2 — pairs**: `id_player, pair_name`
  - Looks up player UUID by csv_id within tournament
  - Groups 2 rows with same pair_name → creates 1 pair
  - Types: `PlayerCsvRow`, `PairCsvRow` in `src/lib/actions/tournaments.ts`

### Knockout bracket logic (Phase 3 done)

- `group_knockout`: collect top `advance_count` from each group (sort by pts → diff → pf)
- `knockout_only`: seed all tournament teams directly (no groups needed)
- Seeding: random shuffle OR by group score (rank 1 all groups first, rank 2 all groups next…)
- Pad to power of 2 with BYE — BYE matches auto-complete and advance winner
- Standard bracket: seed 1 can only meet seed 2 in the final (recursive `bracketSlots`)
- `next_match_id` + `next_match_slot` on each match — winner auto-filled on score entry
- Reset blocked if next match already completed
- Champion banner shown when final match is completed

### Knockout bracket logic (Phase 4 done)

DB additions:

```sql
ALTER TABLE matches
  ADD COLUMN loser_next_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
  ADD COLUMN loser_next_match_slot text CHECK (loser_next_match_slot IN ('a','b')),
  ADD COLUMN bracket text CHECK (bracket IN ('upper','lower','grand_final')) DEFAULT 'upper';
```

Architecture:

- `buildDoubleBracket()` in `bracket.ts` — upper + lower + grand final with `loser_next_match_id` links
- `allow_drop_to_lower=true`: upper losers routed to lower via `loser_next_match_id`
- `allow_drop_to_lower=false` + `has_lower_bracket=true`: lower seeded from 3rd/4th per group; `buildIndependentDoubleBracket()`
- Grand final: single match (no bracket reset)
- Pair mode KO (knockout_only only): seed pairs; `winner_id` = `pair_id`; uses `pair_a_id`/`pair_b_id` slots
- `knockout-stage.tsx`: render three sections by `bracket` column — "สายบน", "สายล่าง", "Grand Final"
- Reset blocked if winner's OR loser's next match already completed

### Phase 5 plan — Bracket Visualization

- New route `/tournaments/[id]/bracket` — server component, full-width, no auth
- `bracket-visual.ts`: `buildVisualBracket(matches)` — 2D array by round
- `bracket-view.tsx`: flex columns + SVG absolute-positioned connector lines; horizontal scroll on mobile
- Upper bracket visual + lower bracket as list (Phase 5 scope)

### Phase 6 plan — Realtime + Share Link

- `share_token text UNIQUE` on tournaments
- `/t/[token]` — public read-only share page (server component, service role)
- `TournamentLiveWrapper` client component: Supabase Realtime `.on('postgres_changes')` → `router.refresh()` on match UPDATE
- `generateShareTokenAction` / `revokeShareTokenAction` in `tournaments.ts`
- `share-controls.tsx` — owner-only copy-to-clipboard + revoke button

### Phase 7 plan — LINE + Export PDF

- New env: `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
- `src/lib/line/messaging.ts`: `sendLineMessage(to, text)` — fire-and-forget (non-blocking)
- `src/lib/export/pdf.ts` (jspdf + jspdf-autotable + Thai font)
- `recordMatchScoreAction`: send LINE notification when match completes (non-blocking)

## MCP servers

- **supabase**: apply migrations, run SQL, list tables — use `apply_migration` for all DDL
- **shadcn**: browse and add components

## Agent skills

Run once per machine: `npx skills add supabase/agent-skills`
`.agents/` is gitignored.
