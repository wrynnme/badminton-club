@AGENTS.md
@MEMORY.md

# Project Operating Rules

## Rules

Shared repo rules live in `@AGENTS.md`. Universal Claude-agent mechanics — JSON envelope, gates, handoff contract, observability, security, anti-hallucination, loop prevention, cost discipline, testing/deployment — are documented in `.claude/agent-operating-rules.md`. That file is **no longer always-loaded** (to save context); read it on demand when orchestrating or when the envelope / handoff-contract / telemetry-schema format is needed. The safety-critical prohibitions, reversibility gates, and security requirements remain always-on in `@AGENTS.md` and `~/.claude/CLAUDE.md`.

This file now contains Claude Code-specific delegation rules plus deep project context. Do not duplicate shared workflow/security/i18n/component rules here; update `AGENTS.md` instead.

## Delegation Rules (Claude Code)

**Default: delegate. Don't do work yourself if a specialized agent fits.**

Main thread acts as Orchestrator — plans, routes, reports. Coding/search/test work goes to subagents via `Agent` tool.

### Routing matrix

| Task                                                    | Agent (`subagent_type`) |
| ------------------------------------------------------- | ----------------------- |
| New API / server action / business logic                | `backend`               |
| UI component / page / form / client logic               | `frontend`              |
| SQL schema / migration / query optimization             | `database`              |
| 3rd-party integration (LINE / Stripe / OAuth / webhook) | `integration`           |
| Write/run tests, verify acceptance, find bugs           | `qa`                    |
| Codebase exploration > 3 queries / "where is X"         | `Explore`               |
| Design implementation strategy / architectural plan     | `Plan`                  |
| Requirements gathering / user stories                   | `requirements`          |
| Fits no specialized agent                               | `general-purpose`       |
| Unsure which agent / multi-domain coordination          | `orchestrator`          |

### When to do it yourself (no agent)

- Single-file edit ≤ 30 lines + you already know the exact location
- Reading 1–2 known files (use `Read` directly)
- Running 1 known shell command (use `Bash` directly)
- Direct git operations (status / diff / log / commit)
- Sync-style chat (Q&A, explanations, decisions)

### Parallelize

Independent work → single message, multiple `Agent` tool calls. Example: backend action + frontend component for the same feature → spawn both in parallel.

### Brief like a colleague

Subagent has no conversation history. Prompt must be self-contained: goal, file paths/line numbers, what's been tried, expected output format. Never write "based on findings, implement it" — name the change.

### After delegating

Trust but verify. Read the actual diff/changes before reporting done. Subagent summary describes intent, not result.

## Shared project rules

Use `@AGENTS.md` for security, reversibility gates, scope drift, learning capture, project workflow, verification, i18n, component conventions, deployment, and data rules.

---

# Project: Badminton Club (ก๊วนแบด)

## Stack

- Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1
- Supabase (Postgres + RLS) — MCP through the Claude.ai Supabase connector
- Auth: LINE Login only (HMAC-signed `bc_session` cookie, no Supabase Auth). Guest signup removed v0.14.0 (2026-06-24) — `isGuest` field + gates kept for legacy cookies; viewers use public links, owners add guest *players* to rosters.
- i18n: `next-intl` 4.x, cookie-based TH/EN (no URL routing) — shared rules live in `@AGENTS.md`
- Font: Google Font Anuphan (`thai` + `latin` subsets)
- Navigation progress bar: `@bprogress/next` 3.x (3px top bar, `var(--primary)`, no spinner)

## Tournament System (Phase 0–13 done; competition mode shipped & live on prod — see `spec.md`)

### Architecture

- `src/lib/tournament/competitor.ts` — `Competitor` type abstracts over `Team` and `Pair`; `buildCompetitorMap`, `teamToCompetitor`, `pairToCompetitor`
- `src/lib/tournament/scheduling.ts` — `balancedRoundRobin(sizeA, sizeB)` rotates sideB each round; `generateAllPairMatches(teamPairs)` produces every inter-team pair matchup
- `src/lib/tournament/scoring.ts` — `computeStandings(matches, unit, ids)` returns `StandingRow[]`; `gameWinner(games)`, `leaguePoints(wins, draws)`; Win=3, Draw=1, Loss=0
- `src/lib/tournament/bracket.ts` — `buildBracket(entries)` generates single-elimination bracket with pre-assigned UUIDs + `next_match_id` links; `buildDoubleBracket(entries)` for full double-elimination; `nextPowerOf2(n)`, `roundLabel`, `lowerRoundLabel`
- `src/lib/tournament/bracket-visual.ts` — `buildVisualBracket(matches, section)` → `VisualRound[]`; `CARD_H`, `CONNECTOR_W` constants
- `src/lib/tournament/settings.ts` — zod `TournamentSettingsSchema`, `parseSettings(raw)` (per-field fallback + legacy `queue_bracket_preference` translator → `normalizeLegacy`), `DEFAULT_SETTINGS` (line_notify, queue_division_order, queue_division_priority, queue_chunk_size, auto_advance_next, court_strict, allow_force_bracket_reset, match_cooldown_minutes, audit_log_enabled, realtime_enabled, etc.)
- `src/lib/tournament/divisions.ts` — pure helpers for N-division: `computePairDivision(pairLevel, thresholds[])` → `1..N | null` (Division 1 = TOP tier), `parseDivision(text)`, `divisionLabelTh(n)` → `"Division N"`, `divisionTone(n)` (cycles 8-color palette), `divisionCount(thresholds)`, `DIVISION_COLORS`
- `src/lib/tournament/entity-stats.ts` — discriminated union `EntityStats = PairStats | PlayerStats | TeamStats | DivisionStats` (tagged with `entityType` literal). Shared `StatsBase` has `played/wins/losses/draws/pointsFor/pointsAgainst/pointsDiff/streak/matches/headToHead: Record<string, HeadToHeadRecord>`. `PlayerStats` requires `partnerBreakdown: Record<string, PartnerRecord>`. Helpers: `computePairStats`, `computePlayerStats` (filters matches where player owns both pairs), `computeTeamStats` (intra-team filtered at predicate), `computeDivisionStats` (filters via `divisionPairIds` set; `winRate` pinned to 0 — aggregate formula meaningless). All loops skip BYE walkovers via `m.games.length > 0` guard. 269 vitest tests.
- `src/lib/tournament/stats-page-data.ts` — `loadStatsTournamentByAdmin(id, fromTab?)` + `loadStatsTournamentByToken(token)` returning `StatsPageData` (tournament + teams + pairs + matches + settings + competitorById + backHref). Shared between 8 stat pages (admin + public × 4 entities).
- `src/lib/tournament/result-display.ts` — `RESULT_TEXT_CLASS` / `RESULT_PILL_CLASS` (CSS only; W/L/D labels moved to the `tournament.result.*` catalog) + `formatWinRate(rate)` / `formatWlLabel(stats)` helpers.
- `src/lib/tournament/settings.server.ts` — `getTournamentSettings(tournamentId)` server helper
- `src/lib/export/csv.ts` — `generateMatchesCsv`, `generateRosterCsv`, `generatePlayerImportTemplate`, `generatePairImportTemplate`, `downloadCsv`

### Schema Tables

- `tournaments` — id, owner_id, name, venue?, start_date?, end_date?, notes?, mode (`sports_day`|`competition`), status, format, match_unit (`team`|`pair`), has_lower_bracket, allow_drop_to_lower (default false), seeding_method (`random`|`by_group_score`), advance_count (default 2), team_count, pair_division_thresholds (numeric[] NOT NULL default `'{}'`, sorted ASC via CHECK + `is_numeric_array_sorted_asc()` IMMUTABLE function), share_token (text, unique, nullable), courts (text[] default `'{}'`), settings (jsonb NOT NULL default `'{}'`) — deprecated singular `pair_division_threshold` column DROPPED 2026-05-22 (migration `20260522000300_drop_pair_division_threshold_deprecated`)
- `teams` — id, tournament_id, name, color, seed
- `team_players` — id, team_id, profile_id?, display_name, role (`captain`|`member`), level text, csv_id text, checked_in_at timestamptz?, created_at; partial index `idx_team_players_checked_in ON (team_id) WHERE checked_in_at IS NOT NULL`
- `groups` — id, tournament_id, name
- `group_teams` — group_id, team_id, position, wins, draws, losses, points_for, points_against
- `pairs` — id, team_id, player_id_1 (FK team_players), player_id_2 (FK team_players), display_pair_name (optional), pair_level text (stored as text; value = numeric sum of player levels), created_at
- `matches` — id, tournament_id, group_id (nullable, FK groups), round_type (`group`|`knockout`), round_number, match_number, team_a_id, team_b_id, team_a_score (int, games-won count by side A; denormalized from `games` for fast display), team_b_score (int, games-won count by side B), pair_a_id, pair_b_id, games jsonb (`[{a,b}]`), winner_id (no FK — accepts team OR pair UUID), status, next_match_id (self-ref), next_match_slot (`a`|`b`), loser_next_match_id (self-ref), loser_next_match_slot (`a`|`b`), bracket (`upper`|`lower`|`grand_final` — DE Winner/Loser/Final, UI labels "สายชนะ/สายแพ้/ชิงชนะเลิศ"), division (text — `'1'..'N'` or null; Division 1 = TOP tier, CHECK `^[1-9][0-9]?$`), court?, queue_position?, scheduled_at?, started_at?
  - partial UNIQUE index `uniq_matches_inprogress_court` on `(tournament_id, court) WHERE status='in_progress' AND court IS NOT NULL` — DB-level court occupancy guarantee
  - index `idx_matches_tournament_queue_position` on `(tournament_id, queue_position)`
- `audit_logs` — id, tournament_id, actor_id text (LINE id or guest id; not uuid), actor_name, event_type, entity_type?, entity_id?, description, created_at
- **RPCs** (service_role only): `record_match_score`, `replace_tournament_matches`, `regenerate_tournament_groups`, `reorder_tournament_queue`, `start_match_atomic` (Phase 12 — row-lock + require_checkin re-verify + status transition)

### Server Actions

- `src/lib/actions/tournaments.ts` — `createTournamentAction`, `updateTournamentAction` (`assertCanEdit` — owner + co-admin), `updateTournamentStatusAction`, `updateTournamentSettingsAction(tournamentId, patch)` (`assertCanEdit`, deep-merges `line_notify`), `addTeamPlayerAction` (incl. level), `updateTeamPlayerAction({display_name?, level?})`, `importPlayersCsvAction(tournamentId, PlayerCsvRow[])`, `importPairsCsvAction(tournamentId, PairCsvRow[])`, `generateShareTokenAction` (owner-only), `revokeShareTokenAction` (owner-only), `updateCourtsAction(tournamentId, names[])` (`assertCanEdit`; trim+slice 40 chars/name, cap 50 entries), Phase 12 check-in: `toggleTeamPlayerCheckInAction({playerId, tournamentId})` (`assertCanEdit`; flips `checked_in_at` between `now()` and `null`; audit `player_checked_in/out`), `bulkCheckInTeamAction({teamId, tournamentId, checkIn})` (idempotent — only touches rows whose state differs via `.is/.not("checked_in_at", null)`; returns `{count, noop?}`; audit `team_bulk_checked_in/out`), `resetAllCheckInsAction(tournamentId)` (sets ALL `team_players.checked_in_at = null` for the tournament; audit `tournament_checkins_reset`). All revalidate via `revalidateAllTournamentPaths` (uses `revalidatePath('/t/[token]', 'layout')` to cover share + tv + court + bracket + stats subtree)
- `src/lib/actions/matches.ts` — `generateGroupsAction`, `generateGroupMatchesAction`, `generatePairMatchesAction` (N-division aware, reads `pair_division_thresholds[]` + `computePairDivision`), `generateKnockoutAction`, `recordMatchScoreAction({ matchId, tournamentId, games })` (via RPC `record_match_score`; respects `auto_advance_next` flag; auto-advance promote leaves the gap in `queue_position` (renumber only on manual drag or `autoRotateQueueAction`)), `resetMatchScoreAction` (respects `allow_force_bracket_reset` — single-level cascade; appends `queue_position = nextPendingTailPosition` so reset row joins queue tail), `cancelMatchAction(matchId, tournamentId)` (in_progress → pending; sets `queue_position = nextPendingTailPosition` in same update so row goes to queue tail), `createManualMatchAction({ tournamentId, pairAId, pairBId })` (pair mode, same division; respects `allow_manual_match_after_bracket`; insert payload includes `queue_position = nextPendingTailPosition`), `reorderMatchQueueAction(tournamentId, orderedIds[])` (via RPC `reorder_tournament_queue`), `setMatchCourtAction({ matchId, tournamentId, court })` (court occupancy guard), `startMatchAction(matchId, tournamentId)` (KO R1 blocked until same-division group matches `completed`; sets `started_at`; respects `match_cooldown_minutes` + `require_court_to_start` + `require_checkin`; final transition via RPC `start_match_atomic(p_match_id, p_player_ids)` — row-locks the match + re-verifies `team_players.checked_in_at` under the lock to close TOCTOU; pending `queue_position` values keep their slots after promote (gap stays until manual drag or `autoRotateQueueAction`)), `autoRotateQueueAction(tournamentId, restGap?)` (reads `auto_rotate_rest_gap` + `queue_bracket_preference` + `queue_chunk_size`; persists via RPC `reorder_tournament_queue`); internal helpers `nextPendingTailPosition(sb, tournamentId)` (returns `max(queue_position)+1` of pending; `1` when empty), `revalidateTournamentPaths` (uses layout-mode revalidate so `/t/[token]` subtree — tv/bracket/court/stats — invalidates in one call)
- `src/lib/actions/pairs.ts` — `createPairAction({ teamId, playerIds: [id1,id2], name? })` — pair_level auto-computed (sum), no pair_code; `deletePairAction`
- `src/lib/actions/admins.ts` — `addCoAdminAction`, `removeCoAdminAction` (owner-only), `getCoAdminsAction`, `getAuditLogsAction`

### Components

- `team-manager.tsx` — add teams + members (numeric level input); captain listed first; inline rename + level edit via `PlayerRow`; Phase 12: per-player "เช็คอิน/พร้อม" Button + row green tint when checked in + `TeamCard` header "X/N พร้อม" badge + bulk `CheckCheck` icon button + "รีเซ็ตเช็คอิน" header Button (visible when totalCheckedIn > 0, confirm prompt)
- `group-stage.tsx` — gen groups (configurable count), gen matches, `GroupCard` per group with `StandingsTable` + `MatchRow`
- `pair-stage.tsx` — `PairManager` grid (per team) + generate pair matches + division standings (N-division loop via `pair_division_thresholds[]`; one Card per division using `divisionLabelTh`/`divisionTone`)
- `pair-manager.tsx` — toggle-select 2 players; name input only (pair_level auto, no pair_code); shows level badges + short UUID
- `knockout-stage.tsx` — gen bracket; renders N outer division sections (when thresholds set) each with `สายชนะ`/`สายแพ้`/`ชิงชนะเลิศ` sub-sections; BYE auto-advance; per-division champion banners; "View Bracket" button
- `tournament-status-control.tsx` — owner/co-admin changes status (draft → registering → ongoing → completed)
- `csv-import-dialog.tsx` — 2-step: step 1 players (upsert by csv_id), step 2 pairs (upsert by pair_id UUID); preview tables; download templates
- `export-buttons.tsx` — Export: matches · roster + Template: players · pairs (canEdit); `isOwner` prop controls template visibility
- `share-controls.tsx` — owner-only: generate/copy/revoke share link + QR Code dialog (`react-qr-code` 240x240)
- `tv-match-card.tsx` — large-format match card for TV display (status pill, court badge, winner highlight, gamesA:gamesB + point totals)
- `co-admin-controls.tsx` — owner-only: add/remove co-admins by LINE user_id
- `audit-log-panel.tsx` — collapsible panel; owner + co-admin; newest-first, limit 50
- `manual-match-dialog.tsx` — Dialog to create manual pair match; filters pair B by same division as pair A
- `tournament-tabs.tsx` — client Tab wrapper: แดชบอร์ด · ทีม · กลุ่ม* · คู่* · น็อคเอ้า* · ตารางคิว* · ตั้งค่า** (\* conditional per format/state — `แดชบอร์ด` always shown, `กลุ่ม` only when `match_unit=team` AND format includes group stage, `คู่` only when `match_unit=pair`, `น็อคเอ้า` only when format includes knockout, `ตารางคิว` shown once matches exist; ** owner+co-admin only via `showSettings`); URL-synced + lazy-mount via shared `useTabSync` hook (`src/lib/hooks/use-tab-sync.ts`)
- `public-tournament-shell.tsx` — public Tab wrapper for `/t/[token]`: แดชบอร์ด · กลุ่ม* · คู่* · สาย* · ตารางคิว* (5 tabs — `ภาพรวม` removed 2026-05-22, no `ทีม`/`ตั้งค่า`); same `useTabSync` hook; parent page wraps it in `<Suspense>` (Next 16 `useSearchParams` requirement)
- `use-tab-sync.ts` (`src/lib/hooks/`) — shared hook `useTabSync<TabId>({ allTabs, validTabs, defaultTab })` returns `{ active, mounted, onChange }`; reads/writes `?tab=` via `useSearchParams` + `router.replace({scroll:false})`; `mounted: Set<TabId>` seeds with `defaultTab` for instant first paint; `useLayoutEffect` + ref guard prevents param-strip race on first render; `onChange` wraps `router.replace` in `useTransition` and pairs it with `progress.start()`/`progress.stop()` from `useProgress()` (`@bprogress/next`) — `startedRef` ensures one stop per start so the top progress bar shows for the full lazy-mount + Suspense window of the next tab
- `public-tv-header.tsx` (`src/components/tournament/public/`) — shared TV-page header used by `/t/[token]/tv` and `/t/[token]/bracket`: logo + title + venue + status pill + fullscreen button + ดูสาย/ออก TV actions
- `match-queue.tsx` — sub-tabs `รอแข่ง` (sortable) / `กำลังแข่ง` / `จบแล้ว` with count badges; per-row court Select (or free-text) + `เริ่ม` / `จบแข่ง` / `ยกเลิก` / `รีเซ็ต` + `จัดคิวอัตโนมัติ` + court status banner; row number shows `queue_position ?? match_number` (lock on start); division badge ("บน" / "ล่าง"); `requireCourtToStart` prop (threaded through `SortableQueueRow` / `NonDraggableRow` / `QueueRowReadOnly` / `QueueRowBody`) disables "เริ่ม" + shows tooltip "ต้องเลือกสนามก่อน" when flag ON and court empty
- `match-list.tsx` — wraps `MatchRow` array; uses `content-visibility:auto` + `contain-intrinsic-size` for off-screen rows
- `court-manager.tsx` — DnD list of court names in Settings tab; 250ms debounce + serialized writes; calls `updateCourtsAction`
- `settings-manager.tsx` — owner-only Settings tab Card; toggles + numeric inputs for `TournamentSettings` flags; 500ms debounce auto-save; unmount-flush
- `tournament-live-wrapper.tsx` — Supabase Realtime; subscribes to match + tournaments UPDATE/INSERT/DELETE → debounced `router.refresh()` (400ms trailing); respects `realtime_enabled`; green LIVE badge
- `tv-auto-refresh.tsx` — `router.refresh()` every 60s (TV fallback when Realtime off)
- `bracket-match-card.tsx` — compact card: competitors + game score + winner highlight; competitor names wrapped in `EntityLink`
- `bracket-view.tsx` — flex-column rounds + CSS horizontal/vertical connector lines; horizontal scroll
- `match-row.tsx` — memoized (custom comparator); names + game score + point totals; "TBD" for unassigned; `matchRowSize` `"compact"` (default) | `"comfortable"` — propagated through `GroupStage` / `PairStage` / `KnockoutStage` / `BracketSection`; competitor names wrapped in `EntityLink`
- `score-form.tsx` — games array UI (add/remove rows of score A : score B); clamps 0–99
- `standings-table.tsx` — P/W/D/L/+−/Pts; Trophy icon for leader; shows pair subtitle (player names); competitor names wrapped in `EntityLink`
- `tournament/stats/entity-link.tsx` — shared client wrapper: `<EntityLink entityType="pair|player|team|division" entityId={id}>name</EntityLink>` derives base path from `usePathname()` (admin `/tournaments/[id]/stats/...` vs public `/t/[token]/stats/...`); plain span fallback when no tournament path detected
- `tournament/stats/pair-stats-view.tsx` — per-pair metric cards (played / W-D-L / win rate / points diff) + streak pill + match history + h2h table; `"use client"`; wrapped in `TournamentLiveWrapper`
- `tournament/stats/player-stats-view.tsx` — same layout as pair view + partner breakdown table + team badge (inline `borderColor`/`color` from `team.color`); accepts `pairById: Map<string, PairWithPlayers>`
- `tournament/stats/team-stats-view.tsx` — aggregates across team's pairs (intra-team matches excluded); per-pair breakdown table; h2h keyed by opponent team
- `tournament/stats/division-stats-view.tsx` — metric cards + pair standings (via `computeStandings`) + recent matches; colored border from `divisionTone(n).border`
- `ui/loading-spinner.tsx` — `<LoadingSpinner fullscreen? className? />` renders `<Loader2 animate-spin />` centered on `min-h-screen` (fullscreen) or `min-h-[60vh]`; theme-aware via `text-muted-foreground`
- `providers/progress-provider.tsx` — `"use client"` wrapper re-exporting `ProgressProvider` from `@bprogress/next/app` with `height="3px"`, `color="var(--primary)"`, `options={{ showSpinner: false }}`, `shallowRouting`; mounted in root layout outside `TooltipProvider`

### Pages

- `/tournaments` — list
- `/tournaments/new` — create form (mode, format, match_unit, pair_division_thresholds[] via ThresholdChipList, advance_count, team_count …)
- `/tournaments/[id]` — detail page with tabs (แดชบอร์ด · ทีม · กลุ่ม · คู่ · น็อคเอ้า · ตารางคิว · ตั้งค่า — `กลุ่ม` only when `match_unit=team` + format includes group stage, `คู่` only when `match_unit=pair`); `canEdit = isOwner || isCoAdmin`; `showSettings = canEdit`
- `/tournaments/[id]/bracket` — visual bracket page (no auth required)
- `/tournaments/[id]/stats/{pair|player|team|division}/[id]` — admin entity stats pages (requires session); `force-dynamic`
- `/t/[token]` — public read-only share page (no auth, fetched by share_token); passes `matchRowSize="comfortable"` to all stages; `max-w-4xl` layout
- `/t/[token]/tv` — full-screen TV display: upcoming/in-progress (top 8) + standings sidebar (top 8) + จบล่าสุด (last 6); `force-dynamic`; wrapped in `TournamentLiveWrapper`
- `/t/[token]/court/[n]` — per-court referee view (public, phone-first `max-w-xl`); `[n]` = URL-encoded court name; in_progress (large card) + top 2 pending; elapsed mm:ss from `started_at`; `TournamentLiveWrapper` + `TvAutoRefresh` 30s fallback
- `/t/[token]/stats/{pair|player|team|division}/[id]` — public entity stats pages (token-based, no auth); `force-dynamic`

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
- Division split: `computePairDivision(pair_level, pair_division_thresholds[])` → `1..N | null`. Division 1 = TOP tier (`pair_level > thresholds[N-2]`); Division N = bottom (`pair_level ≤ thresholds[0]`). Empty `[]` = no split (single bucket).

### Permission System (Phase 7b)

- `src/lib/tournament/permissions.ts` — `assertIsOwner(tournamentId, userId)`, `assertCanEdit(tournamentId, userId)` (owner OR co-admin)
- `src/lib/tournament/audit.ts` — `writeAuditLog(params)` — inserts to `audit_logs` after every write
- `tournament_admins` table — PK (tournament_id, user_id), added_by, added_at
- `audit_logs` table — id, tournament_id, actor_id text, actor_name, event_type, entity_type, entity_id, description, created_at
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
- `matches` + `tournaments` have `REPLICA IDENTITY FULL` so `postgres_changes` payloads include filter columns
- `TournamentLiveWrapper`: Supabase Realtime `postgres_changes` event `*` → debounced `router.refresh()` (400ms trailing); subscribes regardless of status; respects `realtime_enabled` setting
- Owner can generate/revoke token via `share-controls.tsx`

### Pre-tournament Settings (Phase 11)

- `tournaments.settings jsonb` validated by `TournamentSettingsSchema`
- Flags wired: `line_notify.{start,score,bracket,status}`, `auto_rotate_rest_gap` (0-5), `queue_division_order` (`sequential` | `interleaved` | `chunked`, replaces legacy `queue_bracket_preference`), `queue_division_priority` (`number[]` of division indices; `[]` = natural `1..N`), `queue_chunk_size` (1-50), `court_strict` (UI hint only — DB index always enforces), `color_summary`, `export_visible`, `allow_force_bracket_reset` (single-level cascade), `allow_manual_match_after_bracket`, `auto_advance_next` (filters out TBD matches), `realtime_enabled`, `audit_log_enabled`, `match_cooldown_minutes` (0-30, reads `matches.started_at`), `require_court_to_start` (server gate in `startMatchAction` + client `เริ่ม` button disabled when court empty), `require_checkin` (Phase 12 — `startMatchAction` server gate + auto-advance filter; UI per-player + bulk check-in in `team-manager.tsx`)
- `notifyTournamentEvent(tournamentId, event, text, settings?)` in `src/lib/notification/line.ts` — reads settings (or accepts pre-fetched `settings?: TournamentSettings` to avoid re-fetch), short-circuits when `line_notify[event]=false`; callers like `recordMatchScoreAction` + `startMatchAction` hoist the settings fetch and pass it through to the fire-and-forget notify IIFE

### DB performance + page fetches (2026-05-21)

- migration `20260521000100_add_fk_indexes` — 14 covering indexes for unindexed FKs flagged by Supabase advisor (`matches.team_a_id` / `team_b_id` / `next_match_id` / `loser_next_match_id`, `pairs.player_id_1` / `player_id_2`, `group_teams.team_id`, `team_players.profile_id`, `clubs.owner_id`, `club_admins.user_id` / `added_by`, `club_players.profile_id`, `club_expenses.club_id`, `tournament_admins.added_by` + replacement `idx_tournament_admins_user_id`); all `CREATE INDEX IF NOT EXISTS`
- Page fetches parallelized (3 waves) on `/tournaments/[id]`, `/t/[token]`, `/t/[token]/tv`
- Settings tab now editable by co-admin (`updateTournamentAction` / `updateCourtsAction` / `updateTournamentSettingsAction` use `assertCanEdit`); `ShareControls` + `CoAdminControls` still owner-only

### Thai labels

- `น็อคเอ้า` (not "Knockout"), top-level tab `คู่` (in `tournament-tabs.tsx`) but PairStage sub-tab + button label remain `จับคู่` (in `pair-stage.tsx` / `pair-manager.tsx`), `แบ่งกลุ่ม + น็อคเอ้า` (`group_knockout`), `ชิงชนะเลิศ` (Grand Final), `แดชบอร์ด` (first/default-adjacent tab). DB enums + URL params unchanged.

## MCP Servers

- **claude.ai Supabase connector**: apply migrations, run SQL, list tables — use `apply_migration` for all DDL
- **shadcn**: browse and add components (`.mcp.json`)
- **claude.ai Vercel connector**: Vercel project/deployment tools when needed

Do not add repo-scoped Supabase or Vercel HTTP entries unless you also complete their separate OAuth flow. Project-scoped entries take precedence over the already-authenticated `claude.ai` connectors and can make MCP look broken.

## Agent Skills

Run once per machine: `npx skills add supabase/agent-skills`
`.agents/` is gitignored.

## Agent skills

### Issue tracker

Issues + PRDs live as GitHub issues (`gh` CLI); external PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles use their default strings (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
