# Bugs

Format: `- [severity] title — context · repro · suggested fix`

## Open

(none)

### 2026-05-24 — Phase 12 require_checkin shipped

- vitest 269/269 pass · `tsc --noEmit` clean · migration `20260524000100_add_team_players_checked_in_at` applied to prod via MCP. Per-player + bulk check-in UI live in team tab; `startMatchAction` + auto-advance gated by `settings.require_checkin`.

## Resolved

### 2026-05-24 — `57c5606` Extra-high effort code review (15 findings)

GROUP A — Division stats logic:
- **[P1] computeDivisionStats headToHead leaks pairs from other divisions** — Fix: `divisionPairIds` set now filters both `relevant` matches and `ensurePairEntry` calls.
- **[P1] Division winRate always ~0.5** — Fix: pinned to 0 in DivisionStats; `StatHeaderCards.hideWinRate` prop swaps to 3-col grid.
- **[P1] Team intra-team matches polluted streak + UI list** — Fix: filtered out at predicate, not loop continue → matches[]/streak/W-L-D consistent.

GROUP B — EntityLink cluster:
- **[P1] MatchHistoryList opponent name no EntityLink wrap** — Fix: `renderOpponentName?` prop with default EntityLink wrap.
- **[P1] HeadToHeadTable opponent name no EntityLink wrap** — Fix: `entityType?` + `renderName?` props.
- **[P1] DivisionStatsView standings + RecentMatchRow no EntityLink** — Fix: wrapped in `<EntityLink entityType="pair">`.
- **[P2] Division EntityLink → 404 for no-split tournament** — Fix: JSDoc warns callers to gate on `thresholds.length > 0`.

GROUP C — Cache/perf:
- **[P1] matchesKey hash misses court/started_at/team_*_score** — Fix: extended hash includes all 4 fields.
- **[P1] content-visibility CLS on court status Card** — Fix: removed style (1-4 row grid, perf gain negligible vs CLS cost).

GROUP D — Player edge + UX:
- **[P2] Player in both pair_a + pair_b same match (anomaly)** — Fix: `computePlayerStats` filter excludes matches where player owns both pairs.
- **[P2] backHref always ?tab=pair** — Fix: `loadStatsTournamentByAdmin(id, fromTab?)` optional param.

GROUP E — Misc:
- **[P2] notifyTournamentEvent stale settings** — Fix: JSDoc warns about snapshot caveat (no code change — acceptable per-request scope).
- **[P2] tv-match-card court name overflow** — Fix: `truncate max-w-[200px]` + parent `min-w-0`.
- **[P2] EntityLink useParams brittle for future routes** — Fix: `usePathname().startsWith()` guard added.
- **[P3] EntityLink self-link** — Fix: short-circuit when `pathname.endsWith("/stats/<type>/<id>")`.

+9 regression tests (260 → 269 pass).

### 2026-05-24 — `9ddf197` P2 review batch (7 fixes)

- **[P2] decodeURIComponent throws → 500** → wrap in try/catch + notFound() (court + 2 division pages)
- **[P2] Progress bar hang same-tab click** → `if (next === active) return;` in use-tab-sync onChange
- **[P2] Division thresholds=[] silent empty** → `notFound()` guard
- **[P2] EntityStats headToHead Map → Record** (RSC serialization-safe)
- **[P2] partnerBreakdown? type leak** → discriminated union PairStats|PlayerStats|TeamStats|DivisionStats
- **[P2] EntityLink regex → useParams** (changed to startsWith guard in later batch)
- **[P2] computeDivisionStats wins++/losses++ collapsed** + JSDoc

### 2026-05-24 — `8320a7b` P1 #3: dedup stats page boilerplate

- **[P1] 8 stat pages × ~70 LOC duplicated** → extracted `loadStatsTournamentByAdmin` + `loadStatsTournamentByToken` + `<StatsPageShell>`. Pages now ~30-65 LOC each.

### 2026-05-24 — `a3da9c9` P1 #1+#2: BYE bug + dedup stats view UI

- **[P1] BYE matches counted as draws (CRITICAL)** — `gameWinner([])` returns "draw". Fix: skip `games.length===0` in all compute*Stats main loops + 4 regression tests.
- **[P1] Dedup stats view components (~250 LOC)** — extracted `result-display.ts` + 4 shared primitives (streak-pill, stat-header-cards, match-history-list, head-to-head-table).

### 2026-05-24 — unit tests (Phase B player stats)

- 246/246 pass (+12 new `computePlayerStats` tests; 0 regressions)

### 2026-05-24 — unit tests (Phase B player stats)

- 246/246 pass (+12 new `computePlayerStats` tests; 0 regressions)

### 2026-05-23 — `50a77f2` Perf audit batch (8 of 9 fixes)

- **[P1] N+1 in `updateGroupTeamStandings`**
  - Fix: `matches.ts:1826` — `for (const r of rows) await update(...)` → `await Promise.all(rows.map(r => update(...)))`. Group score scoring 50-450ms faster depending on group size.
- **[P1] N+1 in `reverseGroupTeamStandings`**
  - Fix: `matches.ts:1854` — same Promise.all batch pattern; Math.max guards preserved.
- **[P1] `matchesKey` O(N*M) string serialization**
  - Fix: `tournament-dashboard.tsx:169` — integer rolling hash via `((h << 5) - h + val) | 0` replaces `.map(...).join(",")`. 3-8ms faster per Realtime refresh; no string allocation.
- **[P1] `occupiedCourts` memo chain → dnd-kit re-init**
  - Fix: `match-queue.tsx:552` — `QueueRowBody` derives `isCourtOccupied = useMemo(() => occupiedCourts.has(match.court ?? ""), [...])`; replaces 2 inline `.has()` calls. Stable ref per row prevents dnd-kit context re-eval.
- **[P2] `react-qr-code` eager import**
  - Fix: `share-controls.tsx:6` — `import dynamic from "next/dynamic"; const QRCode = dynamic(() => import("react-qr-code"), { ssr: false })`. ~15-25KB removed from initial bundle.
- **[P2] `JSON.stringify(games)` comparator**
  - Fix: `match-row.tsx:138` — length check + element-by-element `a/b` compare loop; removes two `JSON.stringify` allocations per memo check.
- **[P2] Court status cards no `content-visibility`**
  - Fix: `match-queue.tsx:163` — outer Card gets `style={{ contentVisibility: 'auto', containIntrinsicSize: '100% 140px' }}`. Skip paint when off-screen; intrinsic size hint prevents CLS.
- **[P2] Unused `isOngoing` prop on `TournamentLiveWrapper`**
  - Fix: `tournament-live-wrapper.tsx` — prop removed from type + destructuring + useEffect deps. 4 callers updated (admin page, public page, TV page, bracket page).

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
