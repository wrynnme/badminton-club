# Bugs

Format: `- [severity] title — context · repro · suggested fix`

## Open

(none)

### 2026-05-27 — max-effort code review (score matrix + player-link/tiebreak, commits 80ae63a..f94ccb8) — ALL FIXED same-day

0 P0 · 0 P1-correctness. `buildScoreMatrix` logic verified byte-identical to `gameWinner`; BYE/2-direction/guards all correct + tested. Findings below were a11y, dead-code, and test-gap — all resolved 2026-05-27 (tsc clean · 293→307 vitest pass).

**Fix:** #1 `pair-stage.tsx` standings now uses `divisionCompetitorsByKey`, deleted dead `getDivisionCompetitors`. #2 `aria-pressed` on view toggles (group-stage + pair-stage). #3 `standings-table.tsx` Pts tooltip span `tabIndex={0}`. #4 footer extracted as `StandingsSortKeyNote` export; GroupStage/PairStage render it once per section (no more per-table dup). #5 +14 vitest (tie game, all-ties, 3-competitor full matrix, scheduled→score promote, input immutability). #6 `score-matrix.tsx` aria-hidden dots/diagonal + corner `sr-only` label. nit: `pair-manager.tsx` gates EntityLink on `display_name` truthy. docstring: equal-`match_number` → array-order note. (Not fixed — out of scope: `RESULT_TEXT_CLASS.D` yellow WCAG contrast — shared theme token; score format `2:1` vs MatchRow — compact intentional.)

- **[P1] PairStage standings path recomputes competitors + dead `getDivisionCompetitors`** — Context: `pair-stage.tsx` matrix path now routes through memoized `divisionCompetitorsByKey`, but standings path (L317) still calls `getDivisionCompetitors(divMatches)` (L115-121), recomputing a fresh array each render → `StandingsTable` `competitors` ref unstable. Repro: render pair-stage standings tab, profile re-renders. Suspected cause: incomplete migration when the memo was added. Suggested fix: route L317 through `divisionCompetitorsByKey.get(divKey) ?? []` and delete `getDivisionCompetitors`.
- **[P1] View toggle missing `aria-pressed`** — Context: ตาราง/Matrix toggle in `group-stage.tsx` (L143-158) + `pair-stage.tsx` (L262-277) signals active state via color/weight only. Repro: SR/keyboard user can't tell which view is active. Suspected cause: plain `<Button>` pair, no pressed semantics. Suggested fix: add `aria-pressed` to both buttons (or migrate to shadcn `ToggleGroup`, also dedups the copy-pasted markup).
- **[P2] Pts tooltip not keyboard-accessible** — Context: `standings-table.tsx:32-42` `TooltipTrigger render={<span class="cursor-help">}` — base-ui replaces host element → non-focusable `<span>` (no tabIndex). Repro: tab to Pts header → can't open tooltip. Suspected cause: rendered to bare span (other repo tooltips render to `<Button>`: court-manager.tsx:152, match-queue.tsx:233). Suggested fix: `tabIndex={0}` on the span (or render to ghost Button).
- **[P2] Standings footer duplicates per group/division** — Context: `standings-table.tsx:71-73` footer "เกณฑ์จัดอันดับ: …" renders inside `StandingsTable`, which is looped per group (`group-stage.tsx`) + per division (`pair-stage.tsx`). Repro: 4-group page → identical footer ×4. Suspected cause: footer baked into the per-table component. Suggested fix: lift to parent (render once) or `showSortKey?: boolean` prop default false.
- **[P2] score-matrix.test.ts coverage gaps** — Context: 24 cases miss (a) tie game `{a:21,b:21}` → `0:0`/`D`, (b) 3+ competitor full matrix (mixed score/scheduled/none in one row), (c) reverse of case 6 (pending mn=1 then completed mn=2 → must promote to score). Repro: n/a (test gap). Suspected cause: cases written for 2-competitor shape. Suggested fix: add the 3 cases.
- **[P2] score-matrix.tsx a11y polish** — Context: color dots + diagonal `—` exposed to AT with no meaning; empty corner `<TableHead>` has no accessible name. Suggested fix: `aria-hidden` on dots + diagonal glyph; `<span class="sr-only">ทีม/คู่</span>` in corner cell (gate on `unit`).
- **[nit] misc** — empty-string `display_name` → empty link (`pair-manager.tsx:97`, old `.filter(Boolean)` dropped it); `EntityLink` fallback drops `className` if reused off tournament path (`team-manager.tsx:193`); matrix score format `2:1`/`42-38` diverges from MatchRow `2 : 1`/`(42–38)`; `buildScoreMatrix` docstring over-promises determinism on equal `match_number` (relies on stable-sort + array order); standings fragment children not re-indented (prettier). RESULT_TEXT_CLASS.D yellow may fail WCAG AA (shared token, out of scope).

### 2026-05-26 — max-effort code review of theme/table migration (3 findings, all resolved)

- **[P2] HeadToHead name column overflow (regression from `<Table>` migration)** — Context: `head-to-head-table.tsx` migrated grid→shadcn `<Table>` (auto-layout). Repro: long competitor name at ≤390px viewport. Cause: name `<TableCell>` had `truncate` but no width bound; auto-layout sizes cell to content, so `truncate` never clips → table 521px > 390px viewport, แมตช์/ชนะ/แพ้/เสมอ scroll off-screen (sibling match-history opponent cell was correct via `max-w-0 w-full`). Fix: `head-to-head-table.tsx:100` add `max-w-0 w-full`. Validated via Playwright @390px + long-name fixture: name cell 368px→84px, table 521px→236px, last col right 537px→313px (in-viewport); before/after toggle confirmed load-bearing.
- **[P2] Light primary teal-600 + white text = 3.5:1, fails WCAG AA normal text** — Fix: light `--primary`/`--ring`/`--sidebar-primary`/`--sidebar-ring` teal-600 `oklch(0.6 0.118 184.704)` → teal-700 `oklch(0.511 0.096 186.391)` (~5:1, passes AA). Dark teal-500 already 7.3:1.
- **[P3] `globals.css` missing trailing newline** — Fix: appended.
- Logic clean (per-game scores, `Match.games` non-null, BYE walkover non-empty, callers API-stable). `tsc --noEmit` clean.

### 2026-05-25 — UX polish: cursor-pointer audit

- Tailwind v4 cursor-pointer audit shipped. `cursor-pointer` added to `buttonVariants` base + `ui/tabs.tsx`/`ui/select.tsx`/`ui/checkbox.tsx` triggers + raw color-swatch `<button>` in `team-manager.tsx`. DnD handles keep `cursor-grab`; listbox items keep `cursor-default`. `tsc --noEmit` clean. No new findings.

### 2026-05-24 — Phase 12 require_checkin shipped

- vitest 269/269 pass · `tsc --noEmit` clean · migration `20260524000100_add_team_players_checked_in_at` applied to prod via MCP. Per-player + bulk check-in UI live in team tab; `startMatchAction` + auto-advance gated by `settings.require_checkin`.

### 2026-05-24 — Phase 12 Wave A code-review P0 hardening

- vitest 269/269 pass · `tsc --noEmit` clean · migration `20260524000200_rpc_start_match_atomic` applied via MCP. Closes 4 P0 from the max-effort review of commit `618e829`:
  - **P0 #1 (matches.ts:137)** Helper DB error swallow → `collectMatchPlayerIds` + `countUncheckedPlayers` now `throw` on error; `startMatchAction` catches and returns "ตรวจสอบสถานะเช็คอินไม่สำเร็จ".
  - **P0 #2 (matches.ts:1763)** Start-action TOCTOU → atomic RPC `start_match_atomic` row-locks the match + re-verifies check-in under the lock + transitions status in one transaction.
  - **P0 #3 (matches.ts:1720)** PII leak via display_name list → replaced names with count (`รอเช็คอิน N คน`); `findUncheckedPlayerNames` removed in favor of `countUncheckedPlayers` (head:true, no rows fetched).
  - **P0 #4 (matches.ts:110)** `isPair` conflate → discriminated `MatchPlayerCollection` requires BOTH sides populated; TBD slot and empty-roster cases now surface as explicit errors ("ยังกำหนดทั้งสองฝั่งไม่ครบ" / "ทีมไม่มีผู้เล่น").
  - Bonus: auto-advance now writes audit description `ข้ามคิว N แมตช์ (รอเช็คอิน)` when it skipped queue items; emits `auto_advance_skipped` audit row when every candidate was unready.

Wave B/C findings (roster-wide gate, bulk overwrite, cross-device race, CSV upsert preserves check-in, N+1 auto-advance, revalidate error swallow, court/stats revalidate gap) still open — see spec.md "Phase 12 Wave A" section.

### 2026-05-24 — Phase 12 Wave B+C correctness + perf

- vitest 269/269 pass · `tsc --noEmit` clean. Closes 6 findings from the 2026-05-24 review:
  - **V5/S7 — Bulk idempotent**: `bulkCheckInTeamAction` adds `.is("checked_in_at", null)` / `.not(...)` predicates → preserves arrival timestamps; cross-device race becomes harmless. Returns `{ noop: true }` when nothing changed; client toasts "ทุกคนพร้อมอยู่แล้ว".
  - **S4 — Reset lifecycle**: new `resetAllCheckInsAction` + "รีเซ็ตเช็คอิน" Button in TeamManager header (owner+co-admin, confirm prompt with current count). Audit event `tournament_checkins_reset`.
  - **V8 — Revalidate error**: `revalidateAllTournamentPaths` now logs the share_token lookup error and early-returns (mirrors matches.ts pattern).
  - **S8 — Path coverage**: `revalidatePath('/t/[token]', 'layout')` invalidates the entire token subtree — court/bracket/stats included automatically.
  - **V9 — Batch auto-advance**: 3 round-trips replace up to 40. Pre-fetch pair compositions + team rosters + unchecked set, intersect per candidate in JS. Worst-case latency ~1.2-3.2s → ~50-200ms.
  - **V1 — Roster-wide gate**: documented as design intent. Mitigated via `bulkCheckInTeamAction` + `resetAllCheckInsAction`. No code change.

All 15 P0-P2 review findings from `618e829` now closed (V4 was REFUTED during verification).

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
