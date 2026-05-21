# Bugs

Format: `- [severity] title — context · repro · suggested fix`

## Open

### 2026-05-22 — Full E2E test session

- **[P2] Tab label drift between docs and runtime**
  - Context: `CLAUDE.md` + `spec.md` list tabs as `ทีม · กลุ่ม · จับคู่ · น็อคเอ้า · ตารางคิว · ตั้งค่า`. Actual rendered tabs in pair-mode tournament: `แดชบอร์ด · ทีม · คู่ · น็อคเอ้า · ตารางคิว · ตั้งค่า`. `กลุ่ม` tab absent; `จับคู่` renamed to `คู่`; `แดชบอร์ด` added.
  - Repro: Open any pair-mode `group_knockout` tournament detail page, count tab triggers.
  - Suggested fix: update `spec.md` + `CLAUDE.md` "Components → tournament-tabs.tsx" line to reflect current labels + conditional rules (`กลุ่ม` only shown when format requires it and unit=team; `แดชบอร์ด` always shown).

- **[P2] Duplicate "เพิ่มสมาชิก" buttons fragile for automation/AT**
  - Context: When multiple team cards expanded, each has its own "เพิ่มสมาชิก" button with identical accessible name. Playwright role lookup hits the first match (Alpha) instead of the intended team.
  - Repro: Add 2 teams, expand both, query `getByRole('button', { name: 'เพิ่มสมาชิก' })` — returns first card's button.
  - Suggested fix: add per-team `aria-label="เพิ่มสมาชิกในทีม {team.name}"` to button. Improves screen-reader UX too.

## Resolved

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
