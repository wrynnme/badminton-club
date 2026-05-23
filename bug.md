# Bugs

Format: `- [severity] title — context · repro · suggested fix`

## Open

### 2026-05-24 — Code review pass (entity stats + per-court ref view)

**P1 — Bugs**

- **[P1] BYE matches counted as draws in entity-stats** — `src/lib/tournament/entity-stats.ts:58-101, 170-295, 324-426`. `gameWinner([])` returns `"draw"` because `aWins=0===bWins=0`. BYE walkovers have `games=[]` + `status=completed`, so `computePairStats` / `computePlayerStats` / `computeTeamStats` increment `draws++` and `streak={"D"}` for every BYE the entity received. `computeStandings` in scoring.ts is correct because of `if (!aId || !bId) continue` guard. Fix: skip BYE in each loop — `if (m.games.length === 0) continue;` Add regression test.

**P1 — UI dedup refactor (~750 LOC removable)**

- **[P1] Dedup stats view components** — 8 patterns repeated 3-5 sites each across `pair-stats-view.tsx` / `player-stats-view.tsx` / `team-stats-view.tsx` / `division-stats-view.tsx`. Extract: `streak-pill.tsx`, `stat-header-cards.tsx`, `match-history-list.tsx`, `stats-table.tsx`. Plus `src/lib/tournament/result-display.ts` for `RESULT_LABEL_TH` / `RESULT_TEXT_CLASS` / `formatWinRate` / `formatWlLabel`.
- **[P1] Dedup stats page boilerplate (8 pages × ~70 LOC)** — admin + public × 4 entities. Extract `loadStatsTournamentByAdmin(id, session)` / `loadStatsTournamentByToken(token)` + `<StatsPageShell tournamentId backHref>`.

**P2 — Bugs**

- **[P2] `decodeURIComponent` throws URIError on malformed `%XX` → 500 instead of 404** — `src/app/(public)/t/[token]/court/[n]/page.tsx:190`, `src/app/(app)/tournaments/[id]/stats/division/[divKey]/page.tsx:22`, `src/app/(public)/t/[token]/stats/division/[divKey]/page.tsx:21`. Fix: wrap in `try { ... } catch { notFound(); }`.
- **[P2] Progress bar hangs when clicking already-active tab** — `src/lib/hooks/use-tab-sync.ts:99-112`. `progress.start()` fires; `router.replace()` to same URL → React may skip the transition → `isPending` never flips → progress.stop never called. Fix: `if (next === active) return;` at top of `onChange`.
- **[P2] Division stats page silent zero-results with thresholds=[]** — `src/lib/tournament/entity-stats.ts:455` + 2 division page files. Tournament with no thresholds → all matches have `division=null`, but page accepts `divKey=1` because `maxDivision=0+1=1`. Fix: `if (thresholds.length === 0) notFound();` in page, OR handle empty thresholds as "all matches" in `computeDivisionStats`.

**P2 — Design**

- **[P2] `entity-stats.ts` `headToHead: Map` crosses RSC→client boundary** — fragile (React 19 Flight serializes Maps but may change). Fix: return `Record<string, ...>` or `Array<[string, ...]>`.
- **[P2] `EntityStats.partnerBreakdown?` type leak** — only populated for player. Fix: discriminated union per `entityType`.
- **[P2] EntityLink URL detection via regex** — couples to route literals. Fix: `useParams<{ id?, token? }>()` instead.
- **[P2] `computeDivisionStats` `wins++; losses++;` in both `if/else` branches reads as copy-paste bug** — `entity-stats.ts:499-505`. Intentional (each match = +1W +1L) but confusing. Fix: collapse to `if (rawWinner === "draw") { draws += 2 } else { wins++; losses++; }` + JSDoc clarification.
- **[P2] computeDivisionStats `headToHead` semantically overloaded** — stores per-pair standings, not opponent-vs-opponent. Rename to `pairBreakdown` (cleanest via discriminated union from above).

**P3 — Nits**

- **[P3] Self-match anomaly (`pair_a_id === pair_b_id`) double-counts in `computeDivisionStats`** — `entity-stats.ts:508-521`. Guard.
- **[P3] computePlayerStats: player as both player_id_1 and player_id_2 → self as own partner** — `entity-stats.ts:192-196`. Filter `p.player_id_1 !== p.player_id_2`.
- **[P3] EntityLink generates self-link on same page** — `entity-link.tsx:29-33`. `if (pathname.includes(entityId)) return <>{children}</>`.
- **[P3] Team header renders color dot + badge twice (redundant)** — `team-stats-view.tsx:174-199`. Drop one.
- **[P3] Pair stats division badge inferred from first match instead of `computePairDivision`** — `pair-stats-view.tsx:106-108`. Use authoritative lookup.

### 2026-05-22 — Performance audit (deferred — NOW DONE 2026-05-23)

- **[P1] Redundant `getTournamentSettings` calls within one action** — RESOLVED via commit `6932ffe` (cross-file fix in `notifyTournamentEvent`). Moved to Resolved log.

## Resolved

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
