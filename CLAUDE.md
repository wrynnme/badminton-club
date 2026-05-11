@AGENTS.md

# Project: ก๊วนแบด (Badminton Club)

## Stack
- Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1
- Supabase (Postgres + RLS) — MCP connected via `.mcp.json`
- Auth: LINE Login + Guest mode (HMAC-signed cookie, no Supabase Auth)
- Font: Google Font Anuphan (`thai` + `latin` subsets)

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

## Tournament System (Phase 0–3 done)

### Architecture
- `src/lib/tournament/competitor.ts` — `Competitor` type abstracts over `Team` and `Pair`; `buildCompetitorMap`, `teamToCompetitor`, `pairToCompetitor`
- `src/lib/tournament/scheduling.ts` — `balancedRoundRobin(sizeA, sizeB)` rotates sideB each round; `generateAllPairMatches(teamPairs)` produces every inter-team pair matchup
- `src/lib/tournament/scoring.ts` — `computeStandings(matches, unit, ids)` returns `StandingRow[]`; `gameWinner(games)`, `leaguePoints(wins, draws)`; Win=3, Draw=1, Loss=0
- `src/lib/tournament/bracket.ts` — `buildBracket(entries)` generates single-elimination bracket with pre-assigned UUIDs + `next_match_id` links; `nextPowerOf2(n)`, `roundLabel(round, maxRound, bracketSize)`

### Schema tables
- `tournaments` — id, owner_id, name, mode (`sports_day`|`competition`), status, format, match_unit (`team`|`pair`), has_lower_bracket, allow_drop_to_lower (default false), seeding_method (`random`|`by_group_score`), advance_count (default 2), team_count, scoring_rules jsonb
- `teams` — id, tournament_id, name, color, seed
- `team_players` — id, team_id, profile_id?, display_name, role (`captain`|`member`)
- `groups` — id, tournament_id, name
- `group_teams` — group_id, team_id, position
- `pairs` — id, team_id, name (optional)
- `pair_players` — pair_id, player_id; UNIQUE(player_id) — 1 person = 1 pair
- `matches` — id, tournament_id, round_type (`group`|`knockout`), round_number, match_number, team_a_id, team_b_id, pair_a_id, pair_b_id, games jsonb (`[{a,b}]`), winner_id, status, next_match_id (self-ref), next_match_slot (`a`|`b`), court?, scheduled_at?

### Server actions
- `src/lib/actions/tournaments.ts` — `createTournamentAction` (includes `match_unit`)
- `src/lib/actions/matches.ts` — `generateGroupsAction`, `generateGroupMatchesAction`, `generatePairMatchesAction`, `generateKnockoutAction`, `recordMatchScoreAction({ matchId, tournamentId, games })`, `resetMatchScoreAction`
- `src/lib/actions/pairs.ts` — `createPairAction({ teamId, playerIds: [2], name? })`, `deletePairAction`

### Components
- `team-manager.tsx` — add teams + members; captain always listed first
- `group-stage.tsx` — gen groups (configurable count), gen matches, `GroupCard` per group with `StandingsTable` + `MatchRow`
- `pair-stage.tsx` — `PairManager` grid (per team) + generate pair matches + dual standings (team aggregate + per-pair)
- `pair-manager.tsx` — toggle-select 2 players to create pair; delete pairs
- `knockout-stage.tsx` — gen bracket (advance_count per group or all teams for knockout_only), round-by-round match list, BYE auto-advance, champion banner
- `tournament-status-control.tsx` — owner changes tournament status (draft → registering → ongoing → completed)
- `match-row.tsx` — shows competitor names + game score (e.g. "2:0") + point totals; "TBD" for unassigned bracket slots; reset (↺) or "กรอกผล"
- `score-form.tsx` — games array UI (add/remove rows of score A : score B)
- `standings-table.tsx` — P/W/D/L/+−/Pts; Trophy icon for leader; shows pair subtitle (player names)

### Pages

- `/tournaments` — list
- `/tournaments/new` — create form (mode, format, match_unit, advance_count, team_count …)
- `/tournaments/[id]` — detail + TeamManager + GroupStage or PairStage + KnockoutStage

### Scoring rules

- Win = 3 league pts, Draw = 1 pt, Loss = 0 pts
- Match winner determined by games won (e.g. 2:0 or 2:1 out of best-of-3)
- Tie-break: point diff → points for

### Pair scheduling

- `UNIQUE(player_id)` enforces 1 person → 1 pair
- Balanced round-robin rotates sideB so no player plays consecutive matches repeatedly
- `generatePairMatchesAction` deletes existing pair matches before regenerating

### Knockout bracket logic (Phase 3 done)

- `group_knockout`: collect top `advance_count` from each group (sort by pts → diff → pf)
- `knockout_only`: seed all tournament teams directly (no groups needed)
- Seeding: random shuffle OR by group score (rank 1 all groups first, rank 2 all groups next…)
- Pad to power of 2 with BYE — BYE matches auto-complete and advance winner
- Standard bracket: seed 1 can only meet seed 2 in the final (recursive `bracketSlots`)
- `next_match_id` + `next_match_slot` on each match — winner auto-filled on score entry
- Reset blocked if next match already completed
- Champion banner shown when final match is completed
- Pair mode + knockout = Phase 4

### Phase 4 plan (not yet implemented)

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
- `allow_drop_to_lower=false` + `has_lower_bracket=true`: lower seeded from 3rd/4th per group
- Grand final: single match (no bracket reset)
- Pair mode KO: seed pairs from pair standings; `winner_id` = `pair_id`
- `knockout-stage.tsx`: render three sections by `bracket` column — "สายบน", "สายล่าง", "รอบชิง"

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

### Phase 7 plan — LINE + Export

- New env: `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
- `src/lib/line/messaging.ts`: `sendLineMessage(to, text)` — fire-and-forget (non-blocking)
- `src/lib/export/csv.ts` + `src/lib/export/pdf.ts` (jspdf + jspdf-autotable + Thai font)
- `export-buttons.tsx` — client-side blob download; owner-only
- `recordMatchScoreAction`: send LINE notification when match completes (non-blocking)

## MCP servers

- **supabase**: apply migrations, run SQL, list tables — use `apply_migration` for all DDL
- **shadcn**: browse and add components

## Agent skills

Run once per machine: `npx skills add supabase/agent-skills`
`.agents/` is gitignored.
