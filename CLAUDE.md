@AGENTS.md
@spec.md

# Project Operating Rules

## Agent Communication

- All agent outputs must be valid JSON with: trace_id, agent, status, output, assumptions
- Agents do not communicate directly — route everything through the Orchestrator
- Only Orchestrator speaks to the user

## Hard Prohibitions (all agents)

- Never write secrets, tokens, or passwords in any output or file
- Never run destructive DB commands (DROP, DELETE without WHERE) without explicit user approval
- Never deploy to production without QA + Security sign-off
- Never fabricate file paths, function names, or library versions
- Fail fast on errors — never guess through incomplete inputs

## Output Envelope

Every agent responds in this format:

```json
{
  "trace_id": "<inherited>",
  "agent": "<name>@<version>",
  "status": "success | needs_clarification | out_of_scope | error",
  "confidence": "high | medium | low",
  "output": {},
  "assumptions": [],
  "warnings": [],
  "handoff_to": "<agent or null>"
}
```

## Human Approval Required

- After requirements finalized
- After design + architecture are finalized
- Before any production deployment
- Before any destructive database operation

---

# Project: Badminton Club (ก๊วนแบด)

## Stack

- Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1
- Supabase (Postgres + RLS) — MCP connected via `.mcp.json`
- Auth: LINE Login + Guest mode (HMAC-signed cookie, no Supabase Auth)
- Font: Google Font Anuphan (`thai` + `latin` subsets)

## After completing any task

1. Update `spec.md` — current state, decisions made, what's next
2. Update data contracts if any interface changed
3. Never claim "done" without updating `spec.md` first

## Development Rules

- **Forms**: TanStack Form everywhere — `useForm` + `form.Field` + `form.Subscribe`
- **UI**: shadcn/ui components only — no raw `<input>` / `<button>` elements
- **Server actions**: accept plain typed objects (not FormData) — export types in `clubs.ts`
- **Validation**: two layers — client-side TanStack validators + server-side zod
- **DB writes**: through server actions using service role key (bypasses RLS)

## Key Conventions

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

## Tournament System (Phase 0–10 done)

### Architecture

- `src/lib/tournament/competitor.ts` — `Competitor` type abstracts over `Team` and `Pair`; `buildCompetitorMap`, `teamToCompetitor`, `pairToCompetitor`
- `src/lib/tournament/scheduling.ts` — `balancedRoundRobin(sizeA, sizeB)` rotates sideB each round; `generateAllPairMatches(teamPairs)` produces every inter-team pair matchup
- `src/lib/tournament/scoring.ts` — `computeStandings(matches, unit, ids)` returns `StandingRow[]`; `gameWinner(games)`, `leaguePoints(wins, draws)`; Win=3, Draw=1, Loss=0
- `src/lib/tournament/bracket.ts` — `buildBracket(entries)` generates single-elimination bracket with pre-assigned UUIDs + `next_match_id` links; `buildDoubleBracket(entries)` for full double-elimination; `nextPowerOf2(n)`, `roundLabel`, `lowerRoundLabel`
- `src/lib/tournament/bracket-visual.ts` — `buildVisualBracket(matches, section)` → `VisualRound[]`; `CARD_H`, `CONNECTOR_W` constants
- `src/lib/export/csv.ts` — `generateMatchesCsv`, `generateRosterCsv`, `generatePlayerImportTemplate`, `generatePairImportTemplate`, `downloadCsv`

### Schema Tables

- `tournaments` — id, owner_id, name, mode (`sports_day`|`competition`), status, format, match_unit (`team`|`pair`), has_lower_bracket, allow_drop_to_lower (default false), seeding_method (`random`|`by_group_score`), advance_count (default 2), team_count, pair_division_threshold (numeric, nullable), share_token (text, unique, nullable), courts (text[] default `'{}'`), scoring_rules jsonb
- `teams` — id, tournament_id, name, color, seed
- `team_players` — id, team_id, profile_id?, display_name, role (`captain`|`member`), level text, csv_id text, created_at
- `groups` — id, tournament_id, name
- `group_teams` — group_id, team_id, position, wins, draws, losses, points_for, points_against
- `pairs` — id, team_id, player_id_1 (FK team_players), player_id_2 (FK team_players), display_pair_name (optional), pair_level text (auto-computed = sum of player levels), created_at
- `matches` — id, tournament_id, round_type (`group`|`knockout`), round_number, match_number, team_a_id, team_b_id, pair_a_id, pair_b_id, games jsonb (`[{a,b}]`), winner_id, status, next_match_id (self-ref), next_match_slot (`a`|`b`), loser_next_match_id (self-ref), loser_next_match_slot (`a`|`b`), bracket (`upper`|`lower`|`grand_final`), division (`upper`|`lower`|null), court?, queue_position?, scheduled_at?
  - partial UNIQUE index `(tournament_id, court) WHERE status='in_progress' AND court IS NOT NULL` — DB-level court occupancy guarantee

### Server Actions

- `src/lib/actions/tournaments.ts` — `createTournamentAction`, `updateTournamentStatusAction`, `addTeamPlayerAction` (incl. level), `updateTeamPlayerAction({display_name?, level?})`, `importPlayersCsvAction(tournamentId, PlayerCsvRow[])`, `importPairsCsvAction(tournamentId, PairCsvRow[])`, `generateShareTokenAction`, `revokeShareTokenAction`, `updateCourtsAction(tournamentId, names[])` (owner-only; trim+slice 40 chars/name, cap 50 entries)
- `src/lib/actions/matches.ts` — `generateGroupsAction`, `generateGroupMatchesAction`, `generatePairMatchesAction` (division-aware, reads `pair_division_threshold`), `generateKnockoutAction`, `recordMatchScoreAction({ matchId, tournamentId, games })`, `resetMatchScoreAction`, `createManualMatchAction({ tournamentId, pairAId, pairBId })` (pair mode, same division), `reorderMatchQueueAction(tournamentId, orderedIds[])` (RPC), `setMatchCourtAction({ matchId, tournamentId, court })` (court occupancy guard), `startMatchAction(matchId, tournamentId)`, `autoRotateQueueAction(tournamentId, restGap=2)` (anti back-to-back via RPC); helper `revalidateTournamentPaths` refreshes owner page + `/t/[token]` + `/t/[token]/tv`
- `src/lib/actions/pairs.ts` — `createPairAction({ teamId, playerIds: [id1,id2], name? })` — pair_level auto-computed (sum), no pair_code; `deletePairAction`
- `src/lib/actions/admins.ts` — `addCoAdminAction`, `removeCoAdminAction` (owner-only), `getCoAdminsAction`, `getAuditLogsAction`

### Components

- `team-manager.tsx` — add teams + members (numeric level input); captain listed first; inline rename + level edit via `PlayerRow`
- `group-stage.tsx` — gen groups (configurable count), gen matches, `GroupCard` per group with `StandingsTable` + `MatchRow`
- `pair-stage.tsx` — `PairManager` grid (per team) + generate pair matches + division standings (upper/lower when threshold set)
- `pair-manager.tsx` — toggle-select 2 players; name input only (pair_level auto, no pair_code); shows level badges + short UUID
- `knockout-stage.tsx` — gen bracket; renders upper/lower/grand_final sections; BYE auto-advance; champion banner; "View Bracket" button
- `tournament-status-control.tsx` — owner/co-admin changes status (draft → registering → ongoing → completed)
- `csv-import-dialog.tsx` — 2-step: step 1 players (upsert by csv_id), step 2 pairs (upsert by pair_id UUID); preview tables; download templates
- `export-buttons.tsx` — Export: matches · roster + Template: players · pairs (canEdit); `isOwner` prop controls template visibility
- `share-controls.tsx` — owner-only: generate/copy/revoke share link + QR Code dialog (`react-qr-code` 240x240)
- `tv-match-card.tsx` — large-format match card for TV display (status pill, court badge, winner highlight, gamesA:gamesB + point totals)
- `co-admin-controls.tsx` — owner-only: add/remove co-admins by LINE user_id
- `audit-log-panel.tsx` — collapsible panel; owner + co-admin; newest-first, limit 50
- `manual-match-dialog.tsx` — Dialog to create manual pair match; filters pair B by same division as pair A
- `tournament-tabs.tsx` — client Tab wrapper: ทีม · กลุ่ม* · คู่* · Knockout* · ตารางคิว* · ตั้งค่า** (* conditional per format/state, ** owner+co-admin only via `showSettings`)
- `match-queue.tsx` — drag-drop schedule queue: pending (sortable) · in_progress · completed; per-row court Select (or free-text) + ปุ่ม เริ่ม/จบแข่ง/รีเซ็ต + ปุ่ม จัดคิวอัตโนมัติ + court status banner (Phase 9–10)
- `court-manager.tsx` — DnD list of court names in Settings tab; calls `updateCourtsAction` (Phase 10)
- `tournament-live-wrapper.tsx` — Supabase Realtime client component; subscribes to match UPDATE → `router.refresh()`; shows green LIVE badge
- `bracket-match-card.tsx` — compact card: competitors + game score + winner highlight
- `bracket-view.tsx` — flex-column rounds + CSS horizontal/vertical connector lines; horizontal scroll
- `match-row.tsx` — competitor names + game score (e.g. "2:0") + point totals; "TBD" for unassigned slots; reset (↺) or score entry; `matchRowSize` prop `"compact"` (default) | `"comfortable"` (larger text/score/dot) — propagated through `GroupStage`/`PairStage`/`KnockoutStage`/`BracketSection`
- `score-form.tsx` — games array UI (add/remove rows of score A : score B)
- `standings-table.tsx` — P/W/D/L/+−/Pts; Trophy icon for leader; shows pair subtitle (player names)

### Pages

- `/tournaments` — list
- `/tournaments/new` — create form (mode, format, match_unit, pair_division_threshold, advance_count, team_count …)
- `/tournaments/[id]` — detail page with tabs (ทีม · กลุ่ม · คู่ · Knockout · ตั้งค่า); `canEdit = isOwner || isCoAdmin`
- `/tournaments/[id]/bracket` — visual bracket page (no auth required)
- `/t/[token]` — public read-only share page (no auth, fetched by share_token); passes `matchRowSize="comfortable"` to all stages; `max-w-4xl` layout
- `/t/[token]/tv` — full-screen TV display: upcoming/in-progress (top 8) + standings sidebar (top 8) + จบล่าสุด (last 6); `force-dynamic`; wrapped in `TournamentLiveWrapper`

### Route Groups

- `src/app/(app)/` — app pages with SiteHeader (tournaments, clubs, login)
- `src/app/(public)/` — public pages without SiteHeader (`/t/[token]`, `/t/[token]/tv`)

### Scoring Rules

- Win = 3 league pts, Draw = 1 pt, Loss = 0 pts
- Match winner determined by games won (e.g. 2:0 or 2:1 out of best-of-3)
- Tie-break: point diff → points for

### Pair System (flat schema)

- `pairs` stores `player_id_1` and `player_id_2` directly — no junction table
- No `pair_code` — use `pair.id` (UUID) as stable CSV upsert key
- `pair_level` — auto-computed = `player1.level + player2.level` (sum); null if both players have no level
- 1-person-1-pair enforced at app level via OR query before insert
- `pairToCompetitor` builds name from `player1.display_name / player2.display_name`
- Query pairs with players: `select("*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)")`

### CSV Import (2-step)

- **Step 1 — players**: `team, color, id_player*, display_name*, role, level`
  - `csv_id` = `id_player` stored on `team_players` — stable lookup key
  - Upsert: same csv_id → update; new csv_id → insert
  - Auto-creates teams if missing; preset colors if color not specified
- **Step 2 — pairs**: `team, pair_id, id_player_1*, id_player_2*, pair_name`
  - `pair_id` optional — UUID for upsert; empty = new pair
  - `pair_level` not in CSV — auto-computed from player levels on insert/update
  - Upsert: same pair_id → update; empty → insert new
  - Team validated via player membership (not `team` column)
  - Types: `PlayerCsvRow`, `PairCsvRow` in `src/lib/actions/tournaments.ts`

### Level System

- Free numeric (e.g. `3`, `3.5`) — `parseFloat`, no fixed letter scale
- Player level: stored on `team_players.level`
- Pair level: auto = sum of player levels; stored on `pairs.pair_level`
- Division split: `pair_level > tournaments.pair_division_threshold` → upper; else → lower; null threshold = no split

### Permission System (Phase 7b)

- `src/lib/tournament/permissions.ts` — `assertIsOwner(tournamentId, userId)`, `assertCanEdit(tournamentId, userId)` (owner OR co-admin)
- `src/lib/tournament/audit.ts` — `writeAuditLog(params)` — inserts to `audit_logs` after every write
- `tournament_admins` table — PK (tournament_id, user_id), added_by, added_at
- `audit_logs` table — id, tournament_id, actor_id, actor_name, event_type, entity_type, entity_id, description, created_at
- `canEdit = isOwner || isCoAdmin` — passed to all edit components; owner-only: ShareControls, CoAdminControls

### Knockout Bracket

- Single-elimination: seed 1 can only meet seed 2 in the final
- Double-elimination: `buildDoubleBracket()` — upper + lower + grand final with `loser_next_match_id` links
- `allow_drop_to_lower=false` + `has_lower_bracket=true`: lower seeded from 3rd/4th per group (`buildIndependentDoubleBracket`)
- Grand final: single match (no bracket reset)
- Pair mode KO: seed pairs; `winner_id` = `pair_id`; uses `pair_a_id`/`pair_b_id` slots
- Reset blocked if winner's OR loser's next match already completed

### Realtime + Share Link

- `share_token` (UUID, unique nullable) on tournaments
- `/t/[token]` fetches tournament by share_token (service role, no auth)
- `TournamentLiveWrapper`: Supabase Realtime `postgres_changes` on matches → `router.refresh()`
- Owner can generate/revoke token via `share-controls.tsx`

## MCP Servers

- **supabase**: apply migrations, run SQL, list tables — use `apply_migration` for all DDL
- **shadcn**: browse and add components

## Agent Skills

Run once per machine: `npx skills add supabase/agent-skills`
`.agents/` is gitignored.
