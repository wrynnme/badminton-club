# Bugs

Format: `- [severity] title — context · repro · suggested fix`

## Open

_No open bugs._ The four "status unknown (2026-05-23)" items tracked outside this file were all verified RESOLVED in current code (see confirmation below).

### 2026-06-08 — Club dashboard (#10): static + dual-state live-smoke, no findings (develop)

tsc 0 · vitest **70/70** club (incl. new dashboard 6 + cost-summary 5) · prod `next build` OK. Live-smoke on two throwaway guest-owned clubs: **populated** (4 active + 1 reserve, 2 completed + 1 in_progress + 1 pending matches, court_fee 120 + shuttle + a 50฿ expense) → 5 stat cards, both charts (recharts bars), and the player table all render; dashboard "ค่าใช้จ่ายรวม" card = **220฿** == the cost tab footer grand total (reconciles by construction via shared `computeClubCostSummary`). **empty** club → "ยังไม่มีข้อมูล" empty state, no crash. Console **0 errors / 0 warnings / 0 hydration** on both, across tab switches. Throwaway clubs + guest deleted (CASCADE); net-zero (2 NOMKONZ intact, 0 orphan matches/players).

### 2026-06-08 — Club named courts (#9): static + owner live-smoke, no findings (develop)

tsc `--noEmit` 0 · vitest **59/59** club · prod `next build` OK. Owner live-smoke on a throwaway guest-owned club (`court_count=3` → fallback courts `['1','2','3']`, migration not applied): queue tab build buttons render "สนาม 1/2/3", ManualMatchDialog court `<Select>` lists named courts, settings tab `ClubCourtManager` ("จัดการสนาม") renders + old "จำนวนสนาม" input gone — console **0 errors / 0 warnings / 0 hydration** across tab switches. Throwaway club + guest profile deleted (CASCADE); real data net-zero (2 NOMKONZ clubs intact, 0 orphan matches). Migration `20260608000300` + `20260608000400` (court int→text) **APPLIED to prod 2026-06-09** (user-confirmed; window: 0 live in_progress matches). Triggered by report "เพิ่มสนามใหม่ไม่ได้" — root cause was the unapplied `clubs.courts` column (UI rendered but `updateClubCourtsAction` UPDATE errored on the missing column). Post-apply: `clubs.courts`=text[] (2/2 backfilled), `club_matches.court`=text (28 matches intact), occupancy index recreated; add-court live-smoke persisted `['1','2','สนาม A']`; net-zero.

### 2026-06-08 — Club queue: completed matches capped at 15 (RESOLVED, develop)

**[P1] Completed club matches beyond 15 vanished from the จบแล้ว tab.** Context: `club-queue-panel.tsx:975` sliced the completed list `.slice(0, 15)` after sorting newest-first, so a session with >15 finished matches only ever showed the latest 15 (older ones looked lost; the tab count badge also capped at 15). Data was never lost — `clubs/[id]/page.tsx` fetches all `club_matches` with no limit/range. **Fix:** removed `.slice(0, 15)` → all completed matches render (newest-first) and the badge shows the true count.

### 2026-06-08 — T5: granular queue realtime (develop)

Static green: `tsc --noEmit` clean · vitest **421/421** · prod `next build` OK. Opt-in `queue_payload_sync` (default false, no migration): match-queue patches individual rows from postgres_changes UPDATE payloads instead of full refetch; INSERT/DELETE → router.refresh; `suppressPatchRef` pauses patches during drag/reorder. Page-level debounced refresh untouched (authority) → purely additive, default-off → cannot regress the working path. **✅ Single-client happy path LIVE-VERIFIED (2026-06-08)** — temporarily enabled both flags on a real completed tournament, drove the public queue page via `playwright-cli` + temp `console.log`: confirmed `channel status: SUBSCRIBED`, a real `UPDATE matches SET court=…` reached the handler with all columns present (REPLICA IDENTITY FULL live-confirmed), `setItems` patched the row, and the value rendered to the DOM. All instrumentation + flag/data reverted (net-zero; working tree == HEAD). **⚠️ Still unverified:** multi-client concurrency (multi-court races, optimistic-vs-payload reconciliation, dnd-vs-realtime) needs ≥2 simultaneous clients; INSERT/DELETE fallback branch (low risk, plain router.refresh) not exercised. Ships off; the UPDATE-patch core is proven, races still need a live multi-court test before broad use.

### 2026-06-08 — T2: knockout "best Nth place" bracket fill (develop)

All static green: `tsc --noEmit` clean · vitest **421/421** (+5 `selectBracketFillers` cases) · prod `next build` OK. Opt-in setting `knockout_fill_byes` (default false, no migration) fills empty team-mode knockout slots with best non-advancing teams instead of BYEs; gated off the independent-lower-bracket path (avoids double-allocating the next-rank teams). **Not live-tested:** prod has **zero team-mode tournaments** (1 tournament total, pair/group_knockout) so T2 has no current consumer and no reachable UI path to exercise without seeding a throwaway team tournament; the fill logic is unit-tested, the `generateKnockoutAction` wiring is static-verified + default-off (cannot affect the running pair tournament). Flagged for a seeded team-mode smoke if/when a team tournament is created.

### 2026-06-08 — T3: tournament level → levels table FK (develop)

All green: `tsc --noEmit` clean · vitest **416/416** · prod `next build` OK · **live smoke PASS** (public `/t/[token]` + `/t/[token]/stats/player/[id]` render HTTP 200, 0 error markers, level label renders from `level_id`). Migration `20260608000100_add_team_players_level_id` applied to prod with explicit user confirm — additive `level_id` FK + backfill, **72/72 players mapped, 0 unmapped**; **0/36** existing pairs' `pair_level` differs from `real(p1)+real(p2)` (no division shift). `updateTeamPlayerAction` now recomputes pair_level for the edited player's pairs (closed a pre-existing stale-pair_level gap). **Not Playwright-tested:** the admin team-tab level Select add/edit interaction (needs auth) — it mirrors the already-live club `add-guest-player.tsx` Select pattern; server action writes verified in diff.

**Pending (separate confirm):** `ALTER TABLE team_players DROP COLUMN level;` — the dead free-text column is left in place; drop after a few days of develop soak (same pattern as the still-pending `club_players.level` drop).

### 2026-06-08 — T4: collapsible divisions on match page (develop)

All green, no new findings: `tsc --noEmit` clean · prod `next build` OK. `knockout-stage.tsx` + `pair-stage.tsx` "แข่งขัน" sub-tab were already collapsible; the gap was `pair-stage.tsx` "คะแนน" (standings) sub-tab — per-division `StandingsTable` cards rendered all-expanded. Wrapped each in the existing `<Collapsible>` pattern, reusing `isOpen`/`setOpen` so a division's open state is consistent across the แข่งขัน + คะแนน tabs; `EntityLink` kept as a sibling link next to the chevron trigger. No live smoke — presentational change mirroring the already-live matches-tab Collapsible in the same component.

### 2026-06-08 — T1: server-side match_format enforcement (develop)

All green, no new findings: `tsc --noEmit` clean · vitest **416/416 pass** (+10 new cases for `resolveMatchResult`). Closes the Slice 6 follow-up (2) — `recordMatchScoreAction` previously trusted the client-only format clamp, so a `best_of_3`/`best_of_5`/`fixed_2` class match could be saved with an invalid game set (e.g. a 1-game best_of_3 or a 1-1 best_of_3 with no decider) via a direct action call. **Fix**: new pure `resolveMatchResult(games, format)` in `match-format.ts` (reuses `MATCH_FORMAT_BOUNDS`); `recordMatchScoreAction` fetches the class `match_format` and gates the write when `match.class_id != null` (rejects empty/over-length/tied-game/non-clinch/wrong-count with a Thai `reason` via the existing `{ error }` channel). sports_day (`class_id` null) untouched — stays on `gameWinner`. Static-verified only (pure helper + single-action change over the proven `record_match_score` RPC path; no new RSC/client boundary).

### 2026-06-05 — max-effort code review of Phase 13 slices 7+8 + UI fixes (develop, commits up to 26fbb93) — 5 findings, ALL FIXED same-session

Review of `origin/master..develop` (9 finder angles + advisor verify). 5 real bugs, all introduced this session, all on develop (never reached prod). Fixed + tsc clean · vitest 350 · prod build OK.

- **[P1] `upgradeToCompetitionAction` flipped mode even when child migration failed** — the 3 child `.update()` (groups/matches/pairs class_id) didn't capture/check `error`, so a transient failure left mode=competition with some children `class_id=NULL` → orphaned out of every class, **unrecoverable** (retry blocked by "already competition" guard). **Fix** (`classes.ts`): capture `error` on each child update; `if (gErr||mErr||pErr) return` BEFORE the mode flip. Also made it retry-safe — **find-or-create** the MAIN class (a prior partial attempt's MAIN is reused, not re-inserted → no UNIQUE collision) + the `.is("class_id",null)` filters make every update idempotent, so a retry finishes the rest with no rollback / no data loss.
- **[P1] edit form let an owner switch a competition tournament to `match_unit=team`** — the team/pair selector was ungated; `updateTournamentAction` strips only `mode`, so match_unit was written → `showPairs` false (คู่/class tabs vanish) + `buildCompetitorMap("team")` mismatches pair-keyed matches → corrupted competitor map. **Fix** (`edit-tournament-form.tsx`): when `tournament.mode==='competition'`, render a locked read-only "คู่ vs คู่ (ล็อค)" instead of the toggle; also gate the division-threshold editor on `mode!=='competition'`.
- **[P2] `importPairsCsvAction` gated class requirement on `hasClasses`, not mode** — a competition tournament with 0 classes imported pairs with `class_id=null` silently. **Fix** (`tournaments.ts`): fetch `tournaments.mode`; `requireClass = mode==='competition'`; if `requireClass && no classes` → hard error "สร้าง class ก่อน"; loop gates on `requireClass`; empty class_code now reported (added to `unknownClassCodes` as "(ไม่ระบุ)") instead of silent skip.
- **[P2] `parsePairCsv` didn't require a `class_code` column in competition** — a CSV missing the column (old template) parsed every row with `class_code=''` → server skipped all → toast showed only "ข้าม N", looked like success while importing 0. **Fix** (`csv-import-dialog.tsx`): `parsePairCsv(text, requireClass)` adds `class_code` to the `parseFile` required-columns list when the tournament has classes; FilePicker passes `hasClasses` → missing column rejected up front.
- **[P3] audit log falsely reported `mode` changed on every edit** — `before` snapshot didn't select `mode` but `parsed.data.mode` is always populated (schema default) → `undefined !== 'sports_day'` flagged mode each save (even though mode is stripped from the write). **Fix** (`tournaments.ts`): the changedFields loop now iterates `updateData` (mode-stripped) instead of `parsed.data`.

**Not a bug (design, confirmed):** CSV 1-pair-1-row dedup is correct — a pair has a single `class_id` column; same-2-players-in-2-classes is not a supported shape (1-person-1-pair app rule). No change.

### 2026-06-04 — Phase 13 Slice 8 (mode selector + upgrade-to-competition) — Phase 13 COMPLETE

All green, no new findings: `tsc --noEmit` clean · vitest **350/350** · prod `next build` OK · **live browser smoke PASS** (throwaway sports_day tournament with pairs+group+match seeded in prod, upgraded via edit-form button, deleted; verified count=0). Confirmed: `upgradeToCompetitionAction` creates MAIN class + flips mode=competition + migrates all 3 child types (groups/pairs/matches `class_id`) — DB-confirmed; competition tabs + MAIN sub-tab + ClassManager render; create-form Competition mode hides match_unit selector + division threshold. 0 console/hydration errors. One tsc error fixed mid-pass: `updateTournamentAction` input narrowed to `Omit<CreateTournamentInput,"mode">` (anti-downgrade — edit must never reset `mode`).

### 2026-06-04 — Phase 13 Slice 7 (CSV class_code import)

All green, no new findings: `tsc --noEmit` clean · vitest **350/350 pass** · production `next build` OK. `importPairsCsvAction` resolves `class_code` → `class_id` (unknown/empty → skip + `unknownClassCodes`); class-aware pair template + dialog hint/preview/toast. Static-verified only — no live import smoke (low-risk: class lookup is a Map.get over the already-live-tested `pairs` insert path; no new RSC/client boundary).

### 2026-06-03 — Phase 13 Slice 6 (per-class tabs + class assignment + queue prefix + format clamp)

All checks green: `tsc --noEmit` clean · vitest **350/350 pass** (no regression) · production `next build` OK · **live browser smoke PASS** (Playwright, throwaway competition tournament seeded in prod then deleted — create-then-cleanup, verified count=0 after). All 4 assertions passed: (A) generate-groups → 2 group cards with **non-empty pair standings** (PairGroupCard computes from matches — the load-bearing claim, since pair-groups have no `group_teams`); (B) queue `[BG]` class badge; (C) ScoreForm clamp at 3 game rows for best_of_3 + saved a 2-game result; (D) generate-knockout → **single bracket** (semifinals+final, `division=null`, no multi-division layout). **Console/hydration clean — 0 errors, 0 hydration mismatches** (the static-checks-can't-catch risk that bit Slice 5 is verified absent). One tsc error fixed during the pass (Base UI `Select.onValueChange` passes `string | null` → wrapped `(v) => setClassId(v ?? "")`).

- **[P2 — watch] Queue tab shows 0 rows on the first hard navigation immediately after a generate action; a reload fixes it** — Context: during the smoke, the first hard `goto ?tab=queue` right after clicking "แบ่งกลุ่ม" rendered "รอแข่ง 0" although the 2 matches already existed in DB; a hard reload showed "รอแข่ง 2" correctly, and it did not recur on later navigations. Repro: generate groups, then hard-navigate (not soft tab-click) to the queue tab once. Suspected cause: RSC route-cache / `revalidatePath` staleness on the first post-mutation full navigation (orthogonal to Slice 6 — the failure was *all* matches missing, not the class-badge feature; badges render correctly once data is present). Suggested fix: confirm `revalidateTournamentPaths` in the class generate actions covers the queue render path, or investigate Next 16 dynamic-route cache freshness on first post-action hard-nav. Low severity — soft tab navigation + Realtime/`router.refresh()` mask it in normal use.

### 2026-06-02 — verification: 4 stale "status unknown" bugs confirmed RESOLVED (code inspection)

Re-checked the four lingering items from 2026-05-23 against current `master`; all four root causes are gone:

- **[P1] BYE counted as draw in entity-stats** — RESOLVED. `m.games.length > 0` guard present in every `compute*Stats` filter (`entity-stats.ts` L73/238/382/511); BYE walkovers skipped.
- **[P2] `decodeURIComponent('%ZZ')` → 500 instead of 404** — RESOLVED. `try { … } catch { notFound() }` wraps every decode: `court/[n]/page.tsx` L26-30, `pair/[code]` (app+public), `stats/division/[divKey]` (app+public).
- **[P2] `use-tab-sync` progress bar hangs on same-tab click** — RESOLVED. `onChange` early-returns `if (next === active) return;` before `progress.start()` (`use-tab-sync.ts` L104).
- **[P2] division stats `thresholds=[]` silently empty** — RESOLVED. `if (thresholds.length === 0) notFound();` (`stats/division/[divKey]/page.tsx` L36).

No code change needed. tsc/tests unaffected.

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

### 2026-06-01 — `cfbab56` Match-queue mobile readability

- **[P2] ตารางคิว competitor names hidden on mobile** — RESOLVED 2026-06-01 (`cfbab56`). `match-queue.tsx` QueueRowBody was a single horizontal flex; the court `Select` + เริ่ม/จบ/ยกเลิก cluster claimed the width at ≤390px, squeezing the `flex-1 min-w-0` names grid to ~0 so both pair names truncated away. Fix: outer row → `flex-col sm:flex-row` — mobile line 1 = drag/#/division + names (full width, both pairs visible), line 2 = court + actions (`flex-wrap`); desktop single row unchanged + row height grows on mobile. Verified Playwright @390 (names shown, scrollWidth==clientWidth) + @768 (single row). tsc clean.

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
