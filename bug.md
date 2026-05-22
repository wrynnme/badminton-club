# Bugs

Format: `- [severity] title — context · repro · suggested fix`

## Open

### 2026-05-22 — Performance audit (backend + frontend)

- **[P1] N+1 in `updateGroupTeamStandings`** — `src/lib/actions/matches.ts:1826-1838`. Sequential `for (const r of rows) await sb.from("group_teams").update(...)`. Fix: `Promise.all(rows.map(r => ...))`. Saves 50-100ms per group match score.
- **[P1] N+1 in `reverseGroupTeamStandings`** — `src/lib/actions/matches.ts:1854-1866`. Same loop-await pattern. Fix: `Promise.all`. Saves 50-100ms per reset.
- **[P1] Redundant `getTournamentSettings` calls within one action** — `src/lib/actions/matches.ts:211, 336, 1122, 1399, 1561, 1587, 1661`. Each call = a DB round-trip. Fix: pass `settings` through as optional param to helpers (e.g. `applyDivisionPriorityOrdering(sb, tournamentId, "knockout", settings)`).
- **[P1] `matchesKey` O(N*M) string serialization** — `src/components/tournament/tournament-dashboard.tsx:169`. Builds `${m.id}:${m.status}:${m.games.map(...).join(",")}` for 168 matches every refresh. Fix: numeric hash or `${matches.length}:${latestUpdatedAt}`. Saves 3-8ms/refresh.
- **[P1] `occupiedCourts` memo chain → dnd-kit re-init** — `src/components/tournament/match-queue.tsx:552`. `QueueRowBody` reads `occupiedCourts.has(...)` inline; new Set ref on every refresh triggers dnd-kit context re-eval. Fix: derive `isCourtOccupied` once via `useMemo`. Saves 5-15ms/refresh on hot path.

- **[P2] `react-qr-code` eager import** — `src/components/tournament/share-controls.tsx:6`. ~15-25 KB in initial bundle even for users who never open QR dialog. Fix: `dynamic(() => import("react-qr-code"), { ssr: false })`.
- **[P2] `JSON.stringify(games)` fallback in MatchRow memo** — `src/components/tournament/match-row.tsx:138`. Cheap on small arrays but cleaner as direct array compare. Fix: loop compare `a.games[i].a/b`.
- **[P2] Court status cards no `content-visibility`** — `src/components/tournament/match-queue.tsx:169`. Off-screen cards still painted. Fix: `style={{ contentVisibility: 'auto', containIntrinsicSize: '100% 140px' }}` on outer Card.
- **[P2] Unused `isOngoing` prop on `TournamentLiveWrapper`** — `src/components/tournament/tournament-live-wrapper.tsx:17-25`. Kept for "backwards compat" but commented `// no longer gates the subscription`. Fix: remove prop + update callers.

## Resolved

## Resolved

### 2026-05-22 — P2 fixes

- **[P2] Tab label drift between docs and runtime**
  - Fix: `CLAUDE.md` — lines 167, 184, 268 — updated tab list to `แดชบอร์ด · ทีม · กลุ่ม* · คู่* · น็อคเอ้า* · ตารางคิว* · ตั้งค่า**`; spelled-out conditional rules (`แดชบอร์ด` always; `กลุ่ม` only `match_unit=team` + group format; `คู่` only `match_unit=pair`); clarified top-level tab `คู่` vs PairStage internal sub-tab/button still `จับคู่`. `spec.md` required no edits (line 236 already correct).

- **[P2] Duplicate "เพิ่มสมาชิก" buttons fragile for automation/AT**
  - Fix: `team-manager.tsx:257` — added `aria-label={`เพิ่มสมาชิกในทีม ${team.name}`}` to per-team Add Member button. Disambiguates accessible name across multiple expanded team cards.


### 2026-05-22 — Manual verification (not an app bug)

- **[P1→closed] Player level field not persisting via automated fill**
  - Original symptom: E2E run via `playwright-cli` showed `team_players.level = null` for all 8 newly-added players.
  - Manual verification: user edited `team_players.id = f120faac-6d44-4a72-98da-839686ecc887` (Phoenix / NOMKONZ #2), entered `level = "4"`, pressed บันทึก → DB confirmed `level = "4"`.
  - Conclusion: app form + `addTeamPlayerAction` work correctly. Bug was Playwright `fill()` not dispatching the blur/change event TanStack Form needs to commit numeric input state.
  - Action: no code change. Update E2E playbook — after `fill()` on a spinbutton, follow with `press Tab` (or explicit blur) before submit.

### 2026-05-22 — `d721beb` Fix 7 P1 review findings

- **[P1] Cascading BYE >2 passes may miss walkover rounds**
  - Fix: `matches.ts` — BYE resolver now loops while `walkoverable.length > 0` (cap `log2(bracketSize)+2`) instead of fixed 2 passes; catches cascading lower-bracket walkovers in deep double-elim.
- **[P1] BYE matches don't write `loser_next_match` slot=null**
  - Fix: `matches.ts` — `insertAndResolveByes` writes `loser_next_match_slot = null` in both pair-mode and team-mode; lower row's single-null filter now matches.
- **[P1] `divisionChartData` useMemo missing `divisionThresholds` dep**
  - Fix: `tournament-dashboard.tsx` — added `divisionThresholds` to deps; recomputes when owner edits thresholds mid-tournament.
- **[P1] `matchesKey` missing `games` field**
  - Fix: `tournament-dashboard.tsx` — `matchesKey` now includes games length + last game scores; `recentTimeline` pointTotals refresh on mid-match edits.
- **[P1] `addCoAdminAction` doesn't block guest as co-admin target**
  - Fix: `admins.ts` — queries `profiles.is_guest` and rejects guest targets; closes guest-via-coadmin loophole.
- **[P1] `TvStandingsChart` still uses inline XAxis/YAxis**
  - Fix: `tv-standings-carousel.tsx` — migrated `TvStandingsChart` to `OrientableBarAxes` (horizontal); removes inline duplication, `chart_orientation` setting now applies.
- **[P1] `getNextMatchNumber` redundant DB round-trip in `generateKnockoutAction`**
  - Fix: `matches.ts` — `getNextMatchNumber` accepts precomputed override; KO call site reuses `groupMax` instead of a second query.
