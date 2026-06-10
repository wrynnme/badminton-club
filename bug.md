# Bugs

Format: `- [severity] title — context · repro · suggested fix`

## Open

**No open bugs as of 2026-06-10.** Every finding from the 2026-06-09 whole-system core review (`docs/reviews/code-review-core-2026-06-09.html` — 1 P0 + 4 P1 + 23 P2) is closed — full records in Resolved.

The only non-fix is an intentional **WON'T-FIX (locked design — do not re-open)**: `computeExpenseShares` ceil-per-head over-collects a few baht (100฿/3 → 34×3 = 102). By design — equal players pay the same whole baht, the organizer is never short, and it stays reconciled across the cost-breakdown table + ExpenseManager. A fair largest-remainder split was offered and declined (user, 2026-06-09).

Dated entries below are the historical test-run / fix log (kept per the bug-tracking rule), not open bugs.

### 2026-06-10 — `/settings` profile page (#settings): static + guest live-smoke, no findings (develop)

tsc 0 · vitest **475/475**. New: `updateProfileDisplayNameAction` (profile.ts — getSession + zod `.trim().min(1).max(40)` + service-role update + `setSession` cookie re-issue), `/settings/page.tsx`, `EditProfileForm` (TanStack Form). Moved "ออกทุกอุปกรณ์" from header/mobile-nav → /settings; avatar → `<Link href="/settings">`. Guest live-smoke (throwaway `SETTEST_GUEST`): /settings renders profile card + edit field + ออกจากระบบ/ออกจากทุกอุปกรณ์; edit name (React-aware input set) → submit → DB `display_name` = SETTEST_RENAMED, header reflects the new name immediately on the same session (cookie re-issue + `router.refresh()`, no re-login), avatar links to /settings, "ออกทุกอุปกรณ์" no longer in header. Throwaway guest deleted; net-zero. LINE path not browser-smoked (OAuth) — the action has no guest/LINE branch + tsc-clean.

### 2026-06-10 — Club Private/Public `/code-review` (xhigh) + cleanup batch (develop)

`/code-review` xhigh on `master…develop` (14 files, +525/−70): **0 P0 · 0 P1**. All 3 correctness candidates verified **REFUTED** — (1) public-page client components reach club mutation actions: every action `getSession()→loginRedirect()` + `assertCanManageClub/Owner` before any write, anon has no session → no bypass; (2) callback `.single()` race re-read → supabase-js v2 resolves `{data:null,error}` (no throw) → graceful `auth_error=db` redirect; (3) callback null `display_name` → `profiles.display_name` NOT NULL + every insert path supplies it + zod `.min(1).trim()` user-edit guard. Surviving P2/cleanup applied (commit a8fef1e): shared `toPublicClub/toPublicPlayer` sanitizer (+5 vitest; `queue_settings` re-derived to strip unknown jsonb keys), `ShareLinkRow` extracted (dedup vs tournament `share-controls`), club-tabs `validTabs` memo + single-source gate, dedup queue/locked name-list. **Skipped (by-reason):** player-UUID exposure (P3, React key + actions server-gated), `computeClubCostRows` under `hideCost` (also builds public usage cols), origin state→render-derive (would reintroduce SSR hydration mismatch). **Deferred:** shared club page loader (public fetch is intentional subset → would over-fetch). tsc 0 · vitest **475/475** · net-zero live re-smoke (public render + 0 leak + ShareLinkRow + console 0 err).

### 2026-06-10 — Club Private/Public (#visibility): static + 4-state live-smoke, no findings (develop)

tsc 0 · vitest **470/470**. Net-zero live-smoke on a throwaway guest-owned club (`SMOKETEST_CLUB`, court_fee 500 + shuttle_price 25 + total_cost 1000 + sensitive `shuttle_info`/`notes`, 2 players with `discount` + `note` markers): (1) **private default** → `/c/<id>` unauth = not-found body, no club content; (2) **owner UI toggle** (`ClubVisibilityControls` checkbox) flipped `is_public` false→true in DB; (3) **public view** unauth → renders แดชบอร์ด/ลงชื่อ/ล็อคคู่+คิว (no ค่าใช้จ่าย, no ตั้งค่า tab) + "สาธารณะ" badge + roster + owner attribution; full-HTML grep (incl. RSC flight payload) shows **all 4 sensitive markers absent** (SHUTTLE/NOTES/DISCOUNT/per-player NOTE) and all 5 money labels hidden (ค่าสนาม/ค่าลูก/เฉลี่ย-คน/ค่าใช้จ่ายรวม/รวมค่าใช้จ่าย) — confirms the allowlist props strip; console 0 errors; (4) **toggle back private** → `/c/<id>` not-found again. Throwaway club (CASCADE → 2 players) + guest profile deleted; prod net-zero verified (0 rows left). Note: `SMOKETEST_GUEST` does appear in public HTML — that is the intended `โดย {owner.display_name}` attribution line, not a leak.

### 2026-06-09 — Dashboard + cost review fixes (#9+#10): static + live-smoke, no findings (develop)

tsc 0 · vitest **435/435** (70 club) · prod `next build` OK. Applied 8 low-risk fixes from `/code-review max` (court single-prefix, unified `clubCostTotal` for header+card, เฉลี่ย/คน ÷ totalPlayers, shuttle count = in_progress+completed, games-chart keyed by id, expense rollup survivor-filter, shared `playerSessionTotal`, ManualMatchDialog court resync). Live-smoke read-only as guest on NOMKONZ (`776dfbce…`, 33 players / 20 completed / court 3000 + shuttle): games-chart Y-axis renders player **names** (no UUID leak), court chart `สนาม 3/4/5/6` (single-prefix); header `4,680 บาท` == dashboard card `4,680 ฿` == cost-tab footer `รวมทั้งหมด 4,680 ฿`; `เฉลี่ย/คน 142 ฿ · หาร 33 คน`. Throwaway guest profile deleted; prod net-zero (real data read-only, untouched). No open bugs.

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

### 2026-06-10 — /code-review xhigh on club public/private feature: 5 findings, all FIXED pre-merge (develop)

Self-review of the `feat(club): private/public` commit (`cd60e84`, develop only — never reached master/prod) via `/code-review xhigh` (3 finder angles → verify). 1 P0 leak + 4 lower; all fixed same session. tsc 0 · vitest 470/470 · re-smoke confirms the leak is gone (net-zero throwaway: seeded sensitive strings, raw `/c/[id]` payload contains 0 of them).

- **[P0] money/PII leak in the public RSC payload** — `(public)/c/[id]/page.tsx` passed the full `ClubPlayer[]` to client components (`ClubDashboard`/`SortablePlayerList`); `ClubPlayer.discount` (money) + `note` + `profile_id` serialize into the wire payload to anonymous viewers even though no money UI renders. The cost-hiding had zeroed only club-level fees + `expenses=[]`, missing per-player `discount`. **Fix**: `publicPlayers = players.map(p => ({...p, discount:0, note:null, profile_id:null}))` passed to all client components; also stripped `notes`/`shuttle_info` from `publicClub` and removed the `shuttle_info` line from the public header (commonly carries prices). Verified: discount `777`, note `SECRETNOTELEAK`, `SHUTTLEPRICELEAK`, `CLUBNOTESLEAK`, court_fee `600` all → 0 occurrences in the public HTML.
- **[P2] LeaveButton shown to anon** — `sortable-player-list.tsx` `isSelf = sessionProfileId === player.profile_id`; on the public page both are null → `null===null` rendered the self-only "ถอนชื่อ" on every guest row. **Fix**: `isSelf = sessionProfileId != null && ...` (no-op'd to a login-redirect anyway; cosmetic).
- **[P2] share link relative when env unset** — `club-visibility-controls.tsx` `${appUrl}/c/${clubId}` with `appUrl=""` → bare `/c/<id>`. **Fix**: `useEffect` fallback to `window.location.origin` (in an effect to avoid hydration mismatch). Same latent issue exists in tournament `share-controls.tsx` (not touched — pre-existing).
- **[P3] copy() unguarded** — added try/catch + toast on clipboard rejection (insecure origin).
- Verified-correct (no fix): `notFound()` gate, `setClubVisibilityAction` owner-gate, migration default-false, all write affordances `canManage`-gated (defense-in-depth via server `getSession`), table column symmetry, `HourlyHeadcount` is a server component (props don't serialize — switched to publicClub/publicPlayers anyway for defense).

### 2026-06-10 — P2 migrations: guest rate-limit + class match_number race (develop; APPLIED to prod)

The last two open P2s from the core review, both needing a migration. tsc 0 · vitest 470/470. Both applied to prod + DO-block-rollback live-tested (net-zero).

- **[P2] unbounded guest-profile creation** (`route.ts:19`) — the open unauthenticated `POST /api/auth/guest` inserted a `profiles` row for any name≥2 with no cap, scriptable to bloat the table. Fix: migration `20260610000800_create_guest_profile` — RPC takes `pg_advisory_xact_lock('guest_signup')` (serializes count→insert) and rejects (`guest_rate_limit`) when ≥ 60 guest profiles were created in the last minute. **Global window, no IP captured/stored (no PII)**; 60/min is far above legit usage, stops scripted thousands/min. `guest/route.ts` calls the RPC; `auth_error=rate_limit` → "มีการสมัครเล่นเป็น guest มากเกินไป ลองใหม่อีกครั้งในอีกสักครู่". Live-test: happy-path ok / saturate to 61 recent / next blocked / net-zero. Tunable via the 60 + interval literals.
- **[P2] class match_number collision race** (`classes.ts:544`) — concurrent class generations read the same `max(match_number)+1` and assigned overlapping numbers. Fix: migration `20260610000700_reserve_match_numbers` — `tournaments.match_number_hwm int` counter + RPC that atomically `UPDATE … SET hwm = GREATEST(hwm, max(match_number)) + p_count … RETURNING hwm - p_count` (the tournaments row lock serializes concurrent reservers; GREATEST keeps it correct after a sports_day→competition upgrade). `reserveMatchNumbers()` replaces `getNextGlobalMatchNumber`; all 3 class generate actions reserve a contiguous block then insert normally (DB column defaults preserved — no jsonb_populate fragility). Live-test: two reservations don't overlap (base2 = base1 + count) / net-zero. (Had zero prod consumers — competition mode unused — but fixed per user request to close all P2s.)

### 2026-06-10 — P2 migration: club double-draft guard (develop; trigger APPLIED to prod)

**[P2] concurrent `buildNextClubMatchAction` double-draft** (`clubs.ts:819`) — two near-simultaneous build calls read the same busy-set and can draft one idle player into two pending matches; the real harm is both being STARTED → a player in two live matches. Fix: migration `20260610000600_club_match_player_guard` — a BEFORE INSERT/UPDATE trigger on `club_matches` that, on the `in_progress` transition, takes `pg_advisory_xact_lock(hashtext(club_id))` (serializes concurrent starts per club) and `RAISE EXCEPTION 'club_player_busy'` if any of the match's players is already in another in_progress match of the club (array-overlap `&&`, NULL-safe for singles). Guards every path that sets in_progress, not just one action. `startClubMatchAction` maps the error → "ผู้เล่นในแมตช์นี้กำลังแข่งอยู่ในอีกสนาม". **Applied to prod + live-tested** via a DO-block rollback (first start ok / second-with-shared-player blocked / net-zero — no rows persisted). tsc 0 · vitest 470/470. The double-PENDING insert is still possible (benign queue clutter) — only the harmful double-START is blocked.

### 2026-06-10 — P2 code-only batch: 5 core-review leads fixed (develop)

Re-verified the 2026-06-09 core-review P2 list against current code (several were already closed by intervening work — e.g. `importPairsCsv` whole-table scan now uses team-scoped `.in("team_id", allTeamIds)`; capacity race closed by M2 + the join-form deletion). Fixed the 5 still-open + code-only (no migration). tsc 0 · vitest **470/470** (no regression — server-action changes, not covered by the pure-fn suite).

- **[P2] `deleteClassAction` ignored in-progress matches** (`classes.ts`) — guard counted only `status='completed'`; `matches.class_id` is ON DELETE CASCADE, so deleting a class with a live court game silently wiped it mid-play. Fix: count `.in("status", ["completed","in_progress"])`, error "มีแมตช์ที่จบแล้วหรือกำลังแข่ง". (Residual count→delete TOCTOU accepted — rare admin op, no migration.)
- **[P2] `finishClubMatchAction` unvalidated input** (`clubs.ts`) — no runtime validation; a crafted POST could pass negative/huge `scoreA/scoreB` or a bad `winnerSide` straight to the RPC. Fix: reject `winnerSide ∉ {a,b}` and scores outside integer [0,99].
- **[P2] `recordMatchScoreAction` no per-game validation** (`matches.ts`) — validated only `games.length`; a direct call could record negative/NaN/out-of-range game scores, corrupting point totals + group standings (class matches had `resolveMatchResult` but it bounds game COUNT, not value). Fix: each game `{a,b}` must be integer [0,99] (covers both sports_day + class paths).
- **[P2] `importPairsCsvAction` intra-tournament duplicate csv_id last-wins** (`tournaments.ts`) — `playerByCsvId` keyed by `csv_id` alone; two players in one tournament sharing a csv_id → a pair row resolves to whichever was inserted last (wrong player). Fix: detect duplicate csv_id within the tournament's scoped players → return an error before any write instead of silently last-write-wins.
- **[P2] `addTeamPlayerAction` stamped actor profile_id** (`tournaments.ts`) — every manually-added roster player got `profile_id = session.profileId` (the owner), tagging all of them as the owner. Fix: `profile_id: null` (roster players aren't LINE accounts; grep-verified nothing reads `team_players.profile_id`, so safe).

### 2026-06-10 — Migration batch #1/#2/#3: concurrency races + session revocation (develop; M1–M3 APPLIED to prod)

Closes 3 entries from the 2026-06-09 core-review Open list. tsc 0 · vitest **470/470** · introspect-verified pre/post apply.

- **[P2→fixed] group_teams unlocked RMW** — `matches.ts` `updateGroupTeamStandings`/`reverseGroupTeamStandings` now share `applyGroupTeamStandings(sign)` calling RPC `apply_group_team_delta` (atomic `col = GREATEST(0, col + delta)`). Fix: migration `20260610000100` (applied). Two concurrent score recordings in the same group no longer lose an update.
- **[P2→fixed] club join capacity overshoot** — `clubs.ts` `addGuestPlayerAction` → RPC `add_club_player` (capacity count + status decision + insert under `clubs` row `FOR UPDATE`). Fix: migration `20260610000200` (applied). Concurrent adds at the cap now serialize; overflow lands as `reserve`.
- **[P1 follow-up→fixed] session revocation** — `profiles.session_version` + RPC `bump_session_version` (migration `20260610000300`, applied; 11/11 profiles sv=0). `session.ts`: `sv` stamped into `bc_session` at login; `getSession()` (wrapped in **`React.cache()`** — exactly 1 profiles PK read/request, fail-open on DB error) rejects tokens whose `sv` ≠ live column; missing `sv` = 0 (graceful — no mass logout). New `POST /api/auth/logout-all` bumps version + clears cookie; "ออกทุกอุปกรณ์" buttons in `site-header.tsx` + `mobile-nav.tsx`. Multi-device logins stay valid (login does NOT bump).
- **Bundled**: dead `team_players.level` text refs removed (`types.ts`, print roster, `csv.ts` → `embeddedReal` via `levels:level_id(real)` embed) — code-side prerequisite for M4.
- **M4 DROP `team_players.level`** ✅ **APPLIED 2026-06-10** (migration `20260610000500`, Gate-4 user-confirmed) — applied via MCP AFTER develop→master deploy (commit `60970c9`) verified READY on prod (Vercel poll), so the new `level_id` code was live before the column vanished. Post-drop verify: 0 `level` columns, `level_id` intact, 72/72 players carry `level_id` (no data loss), prod public `/t/[token]` (selects `team_players(*)`) + homepage both HTTP 200. Closes the last EXPAND/contract drop — no legacy level/shuttle_fee columns remain anywhere.
- **NEW FINDING → fixed same day (user-approved)**: post-apply grant audit — 4 older RPCs (`finish_club_match`, `delete_club_match`, `create_club_locked_pair`, `remove_club_player_and_promote`, `start_match_atomic`) + the 3 new ones carried anon/authenticated EXECUTE from Supabase default privileges (`REVOKE FROM PUBLIC` doesn't strip them). **Not exploitable** — all touched tables verified RLS-on with SELECT-only policies, so anon-invoked SECURITY INVOKER writes hit 0 rows/error. Hardening migration `20260610000400_revoke_rpc_execute_anon` applied 2026-06-10; post-apply verify: all 8 → `postgres + service_role` only.

### 2026-06-09 — Cost/usage cols + CSV export + delete-club + manager-only (develop) — static green

Feature batch (see spec.md "Cost/usage columns + CSV export + delete-club + manager-only"): ceil-all rounding; cost table +ชม./ลูกที่ใช้ + Export CSV; dashboard player table +เวลา/ชม./ลูกที่ใช้/ค่าสนาม/ค่าลูก/รวม; owner-only delete-club (type-name confirm, CASCADE ×5 verified live); removed LINE self-join (`join-form` + `joinClubAction` deleted) + renamed เพิ่มผู้เล่น(guest)→เพิ่มผู้เล่น. **tsc 0 · vitest 95/95 club** (+12 new: cost-usage 8, cost-csv 4). New pure helpers all unit-tested (`clampedSessionMinutes`, `computePlayerUsage`, `formatHours`, `generateClubCostCsv`, `firstFreeCourt`/`occupiedCourtMap`). ⚠️ UI render paths (new columns, export download, delete dialog, removed join section) NOT live-smoked — verify on Vercel preview before master merge.

### 2026-06-09 — Code review: court picker + reserve drag-promote (commit 3b2f09e) — 10 fixes (develop)

`/code-review max` over the `master..develop` delta (court occupancy picker + reserve drag-promote + auto-promote-on-cap-raise, commit `3b2f09e`). 9 finder angles → no P0/P1; surfaced P2 concurrency/UX + P3 polish. All fixed in a follow-up commit. **Static-verified: tsc 0 · vitest 83/83 club (+7 new `courts.test.ts`).** ⚠️ **Live-smoke (DnD promote / cap-raise / reorder-mid-list / interval-gate-release) still PENDING — required before merge-to-master** (the touched code paths are DB/browser-coupled and unexercised by the unit suite).

- **[P2] `promoteReservesToFill` ran on every `updateClubAction` + unlocked** — `clubs.ts`. Fix: fetch `max_players` in the existing auth select, gate `if (parsed.data.max_players > club.max_players)` → no wasted count queries on unrelated saves, no surprise promotes, narrows the unlocked race to the rare cap-raise. Residual (documented): a cap-raise still races a concurrent join (no row lock) → can exceed cap by the join count; promote to an RPC if it ever races hot.
- **[P2] bulk promote missing status re-check** — added `.eq("status","reserve")` to the `.update(...).in("id",…)` so a concurrent kick/leave-promote can't be resurrected.
- **[P2] `promoteClubReserveAction` false-error on concurrent promote** — when 0 rows flip, re-read status; if already `active` (leave-RPC won the race) return `{ok:true}` instead of "เลื่อนไม่ได้".
- **[P2] `ActiveDropZone` false affordance** — dashed "วางที่นี่" target only renders when active is empty (zone IS the droppable); when active has rows the zone is disabled (rows are the targets) so it now shows only a subtle ring, not a misleading drop banner. (Boundary-gap drop still no-ops by design — preserves drop-back-to-cancel.)
- **[P2] optimistic promote/reorder reverted by 30s auto-refresh** — `mutatingRef` (set before the transition, reset in `finally`) makes the interval skip its tick while an optimistic mutation is in flight. Partial by nature (only guards the timer; a non-interval parent re-render still reconciles via the `[players]` effect).
- **[P3] court `<Label>` lost association** — added `role="group"` + `aria-labelledby` on the grid + `id` on the Label (kept `aria-pressed`, did not over-engineer to radiogroup).
- **[P3] reserve drag handle ~16px touch target** — both active + reserve grab handles bumped to `h-9 w-9` (36px) tap area, no vertical negative margin (avoids adjacent-row overlap).
- **[P3] court resync effect fired every 30s tick / jumped selection** — effect deps now `[courts, court]`; reads `matches` via `matchesRef` so only an actual court removal (not occupancy churn) moves the open dialog's selection.
- **[P3] `nameMap` not memoized → `lastMeetingLabel` memo defeated** — wrapped in `useMemo([players])`.
- **[Cleanup] occupancy filter duplicated** — extracted `firstFreeCourt` + `occupiedCourtMap` to pure `src/lib/club/courts.ts` (single source for grid + default; +7 vitest). The court-grid memo + default-court picker now derive from the same filter.
- **[Won't fix] reserve rows animate as reorderable** — standard @dnd-kit drag feedback; converting reserves to `useDraggable` would break the working cross-container drop + remove drop-to-cancel. Left as-is.

### 2026-06-09 — Co-admin search leaked line_user_id (PII enumeration) (P2) (develop)

tsc 0 · vitest 450 · build OK. No DB migration.

- **[P2] profile search returned `line_user_id` to any owner → PII-enumeration oracle** (`actions/admins.ts:203` + mirror `actions/clubs.ts:644`) — `searchProfilesAction` / `searchClubProfilesAction` selected `id, display_name, line_user_id` and the UI rendered the `line_user_id` under each result, so an owner could enumerate the LINE platform id of every user whose `display_name` ILIKE-matched a probe. Fix: drop `line_user_id` from the SELECT + the `ProfileSearchResult` / `ClubProfileSearchResult` types (it stays as a server-side `.not(...is null)` guest filter, never returned); re-key `addCoAdminAction` / `addClubCoAdminAction` on the opaque profile **id** (UUID-validated, looked up by `id`) instead of `line_user_id`; UI (`co-admin-controls.tsx` + `club-co-admin-controls.tsx`) passes `selected.id` and no longer displays the line id in search results. Existing co-admin list (owner's own deliberately-added admins, from `getCoAdmins`) unchanged — not an enumeration vector. Sole-caller verified for both actions before the signature swap (both `string`→`string`, so tsc couldn't catch a stray caller). Live add-flow smoke deferred (needs owner + 2 real LINE profiles); static checks + unchanged insert logic cover the path.

### 2026-06-09 — Division stats: cross-bucket matches double-standard (P2 ×2) (develop)

tsc 0 · vitest 450 (entity-stats 49, +1 cross-bucket; 1 existing test corrected) · build OK. No DB migration.

- **[P2] `computeDivisionStats` counted cross-bucket matches in the aggregate that the per-pair standings dropped** (`tournament/entity-stats.ts:513` + `:537`) — `relevant` admitted a match when the stored `division` matched AND **either** side was a division pair (OR). The aggregate W/L loop then counted such a one-sided/mis-stamped match (played++/wins++/losses++), but the per-pair standings only credited the in-division side — so the division summary and its own standings table disagreed (e.g. "1 played" but the opponent pair absent from standings). Fix: require **both** sides in-division (OR→AND) so a cross-bucket match is dropped entirely from played, aggregate, and standings — consistent by construction. No-split (`thresholds=[]`) is a no-op (every pair in the single bucket). New regression test asserts a `division="1"` match with a Division-2 opponent is excluded from played + standings; one prior test that asserted the old one-sided "defensive boundary" behavior was corrected (it encoded the bug).

### 2026-06-09 — Club cost: by_time court split dropped fee on cross-midnight session (P2) (develop)

tsc 0 · vitest 448 (+6 cross-midnight) · build OK. No DB migration.

- **[P2] `computeCourt` by_time silently dropped the ENTIRE court fee when the session crosses midnight** (`club/cost-split.ts:97`) — a session like 21:00→01:00 gives `s0=toMin("21:00")=1260`, `s1=toMin("01:00")=60`, so `sessionMin = 60-1260 = -1200` hit the `if (sessionMin <= 0) return out` guard → everyone's court share = 0 (the whole fee vanished). Player windows also collapsed (`pe < ps`). Fix: detect `s1 < s0` (cross-midnight) and extend `s1 += 1440`; a new `place()` helper shifts early-morning player times (`< s0`) by +24h onto the same timeline so segments/presence compute correctly. `s1 === s0` is preserved as a zero-length window (→ no fee, unchanged) — NOT a full 24h. Non-crossing sessions are byte-identical (helper is a no-op). 6 new tests: regression (fee not dropped), cross-midnight segmenting, single-player-whole-court, overstay clamp, overlapping windows, start==end zero. **Known limitation (benign):** a player whose explicit `start_time` is *before* a cross-midnight session start is ambiguous from HH:MM alone and maps to next-day; the fee is still fully collected (via gap-spread), never dropped.

### 2026-06-09 — Settings: per-field fallback wiped sibling flags (P2) (develop)

tsc 0 · vitest 442 (+3 line_notify recovery) · build OK. No DB migration.

- **[P2] parseSettings per-field fallback reset the WHOLE nested object on one corrupt sub-flag** (`tournament/settings.ts:143`) — the fallback loop did `fieldSchema.safeParse(normalised[key])` per top-level key. `line_notify` is a nested object of 4 boolean flags; if a manual DB edit corrupts ONE sub-value (e.g. `start:"yes"`), the whole-object parse fails → the key is skipped → `line_notify` resets to DEFAULT (all true), silently wiping the user's `score:false`/`bracket:false`. Fix: new `recoverObjectField(objSchema, value, fallback)` helper recovers nested-object sub-values individually — keeps every sub-flag that parses, falls back ONLY the corrupt one to its default; the loop routes `key === "line_notify"` through it (the only nested object). Verified against zod v4: `{start:"yes",score:false,bracket:false,status:true}` → `start` recovers to true, `score`/`bracket` stay false. Read-time recovery only — the write path (`updateTournamentSettingsAction`) keeps strict whole-object validation (a schema `.catch()` would silently coerce garbage on write). Non-object `line_notify` still falls back wholesale (existing test green). Scalars/enums/arrays unchanged; `queue_division_priority` (array) still falls back wholesale by design.

### 2026-06-09 — Club queue: queue_position duplicate-position race (P2) (develop)

tsc 0 · vitest 70 club tests · build OK. **No DB migration** (created_at tiebreak chosen over advisory-lock RPC — user confirmed 2026-06-09).

- **[P2] concurrent club tail-inserts collide on `queue_position`** (`actions/clubs.ts` `buildNextClubMatchAction` + `createClubManualMatchAction`) — both read `max(queue_position)+1` among pending then insert non-atomically; two concurrent calls produce duplicate positions (no DB unique constraint on the column). Symptom is ordering ambiguity only, never data loss. Fix: make duplicates **harmless** instead of impossible — every read site now orders pending by `(queue_position ASC, created_at ASC)`. Server fetch (`clubs/[id]/page.tsx`) adds the secondary `.order("created_at")`; client panel (`club-queue-panel.tsx`) replaces the inline `queue_position`-only comparator at both sort sites with a shared `byQueueThenCreated` helper. `created_at` is non-nullable (DB default), so the tiebreak always resolves. Insert logic unchanged (dup positions now don't matter); `reorderClubQueueAction` already renumbers 1..N on any manual drag, cleaning up any collisions. This prevents user-visible disorder from concurrent inserts; it does **not** make duplicate positions impossible at the DB (by design — no migration).

### 2026-06-09 — Core review P2 safe batch (4 fixes) (develop)

tsc 0 · vitest 439 (+1 scoring BYE) · build OK. No DB migration.

- **[P2] open-redirect** (`api/auth/guest/route.ts`, `api/auth/line/route.ts`, `(app)/page.tsx`) — `safeRedirectTo`/inline guard blocked `//host` but not `/\host`; the WHATWG URL parser normalizes `\`→`/`, so `new URL("/\\evil.com", base)` redirected off-origin. Fix: reject when `value[1]` is `/` **or** `\` at all three sites.
- **[P2] service-role module lacked `server-only`** (`lib/supabase/server.ts`) — added `import "server-only"` so the build hard-fails if a client component ever imports the file holding `SUPABASE_SERVICE_ROLE_KEY`.
- **[P2] computeStandings credited BYE walkovers as draws** (`tournament/scoring.ts`) — `gameWinner([])` returns "draw"; a completed match with `games=[]` got a phantom 0-0 draw. Fix: `if (!Array.isArray(m.games) || m.games.length === 0) continue;` (mirrors the entity-stats guard). +1 scoring test.
- **[P2] reorderPlayersAction swallowed per-row update errors** (`actions/clubs.ts`) — `Promise.all` without checking results; now inspects each `{error}` and returns on failure (mirrors `reorderClubQueueAction`).

Also closed earlier in the session: **decode() shape validation** (`session.ts`, in the expiry commit). **Expense ceil over-collect** triaged won't-fix/intended (see Open).

### 2026-06-09 — Core review P1s: session expiry + bracket-visual lower-drop (develop)

tsc 0 · vitest 438 (+3 bracket-visual) · build OK. No DB migration.

- **[P1] session token had no expiry/revocation** (`src/lib/auth/session.ts`) — Fix: `encode()` now stamps `iat` (epoch sec) into the signed payload; `decode()` rejects tokens with no `iat` or older than `MAX_AGE` (server-enforced — the cookie `maxAge` is browser-only). Also validates payload shape instead of blindly casting (closes P2 #14). **Deploy note:** pre-rollout cookies lack `iat` → all users get one forced re-login. Per-token revocation still deferred (see Open). Live-smoke: fresh guest login → cookie carries `iat`, header renders the user + logout = `decode` accepts it; no-cookie = login link. Throwaway guest deleted, net-zero.
- **[P1] buildVisualBracket dropped lower-bracket matches** (`src/lib/tournament/bracket-visual.ts`) — Fix: lower section now renders one slot per actual match at uniform height (`สายแพ้ รอบ N` label) instead of single-elim halving `slotCount` that sliced real matches off the admin + public bracket pages. Upper bracket keeps halving geometry; grand-final (1 match) unaffected. New `bracket-visual.test.ts` (3 cases) covers the no-drop regression.

### 2026-06-09 — Tournament IDOR cluster (core review: P0 + 3×P1) (develop)

Root cause was one pattern: a server action authorized `assertCanEdit(input.tournamentId)` then loaded/wrote the target row by its own id without checking that row's `tournament_id` matched the authorized tournament. Fix = scope the target to the asserted tenant. No DB migration. tsc 0 · vitest 435 · build OK.

- **[P0] `recordMatchScoreAction` cross-tournament write** (`matches.ts:1106`) — Fix: after fetch, `if (match.tournament_id !== input.tournamentId) return error`. Any LINE user could otherwise record a score onto another tournament's match (match ids are exposed on public `/t/[token]` pages).
- **[P1] `recordMatchScoreAction` double-counts standings** (`matches.ts:1160`) — Fix: added `if (match.status === "completed") return error` (UI only renders ScoreForm on non-completed matches, so editing already goes through reset → no legit path blocked).
- **[P1] `resetMatchScoreAction` cross-tenant standings corruption** (`matches.ts:1491`) — Fix: tenant check immediately after fetch so `reverseGroupTeamStandings` never runs on an out-of-tenant match (the RPC was already scoped).
- **[P1] team-write IDOR** (`tournaments.ts`) — `deleteTeamAction`, `addTeamPlayerAction`, `removeTeamPlayerAction` now fetch the team (or player→team) and assert `tournament_id === tournamentId` before the write, mirroring `toggleTeamPlayerCheckInAction`.

Full review + remaining open follow-ups (P1 session-expiry, P1 bracket-visual, 23×P2): `code-review-core-2026-06-09.html` + `## Open`.

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
