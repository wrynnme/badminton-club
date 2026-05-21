# Bugs

Format: `- [severity] title — context · repro · suggested fix`

## Open

### 2026-05-21 — Code review (develop branch, pending fix)

- **[P1] Cascading BYE >2 passes may miss walkover rounds** — `buildBracket` / KO advancement; multi-level BYE chains not propagated through every round.
- **[P1] BYE matches don't write `loser_next_match` slot=null** — lower bracket cannot auto-complete because loser slot stays unset on BYE-walkover.
- **[P1] `divisionChartData` useMemo missing `divisionThresholds` dep** — Dashboard chart stale when thresholds change mid-session.
- **[P1] `matchesKey` missing `games` field** — `pointTotals` recomputation stale until full reload.
- **[P1] `addCoAdminAction` doesn't block guest as co-admin target** — should reject when target user_id is a guest id (non-LINE).
- **[P1] `TvStandingsChart` still uses inline XAxis/YAxis** — missed the `OrientableBar` migration; `chart_orientation` setting ignored here.
- **[P1] `getNextMatchNumber` redundant DB round-trip in `generateKnockoutAction`** — match offset already available locally; second query unnecessary.

### 2026-05-22 — Full E2E test session

- **[P1] Player level field not persisting via automated fill**
  - Context: E2E flow via `playwright-cli` skill on `/tournaments/<id>` ทีม tab → "เพิ่มสมาชิก" form. Filled `display_name` + numeric `level` spinbutton then submitted. DB `team_players.level` came back `null` for all 8 players.
  - Repro: Open team add form, set level spinbutton via `fill()` (no blur), submit. Check `SELECT id, display_name, level FROM team_players WHERE team_id = '<id>'`.
  - Suspected cause: TanStack Form `onChange` validator may need `blur` or native `input` event that Playwright `fill()` does not dispatch. Or the `addTeamPlayerAction` server-side parser drops non-string `level`.
  - Verification needed: reproduce manually in browser (type level + tab out + submit) — if level persists manually but not via Playwright, the bug is automation-only; if it fails manually too, the form/server is broken.
  - Suggested fix: in `player-row` / team add form, ensure spinbutton uses `onChange` (not just `onBlur`) for level state update; in `addTeamPlayerAction` confirm `level` is read as string and stored verbatim.

- **[P2] Tab label drift between docs and runtime**
  - Context: `CLAUDE.md` + `spec.md` list tabs as `ทีม · กลุ่ม · จับคู่ · น็อคเอ้า · ตารางคิว · ตั้งค่า`. Actual rendered tabs in pair-mode tournament: `แดชบอร์ด · ทีม · คู่ · น็อคเอ้า · ตารางคิว · ตั้งค่า`. `กลุ่ม` tab absent; `จับคู่` renamed to `คู่`; `แดชบอร์ด` added.
  - Repro: Open any pair-mode `group_knockout` tournament detail page, count tab triggers.
  - Suggested fix: update `spec.md` + `CLAUDE.md` "Components → tournament-tabs.tsx" line to reflect current labels + conditional rules (`กลุ่ม` only shown when format requires it and unit=team; `แดชบอร์ด` always shown).

- **[P2] Duplicate "เพิ่มสมาชิก" buttons fragile for automation/AT**
  - Context: When multiple team cards expanded, each has its own "เพิ่มสมาชิก" button with identical accessible name. Playwright role lookup hits the first match (Alpha) instead of the intended team.
  - Repro: Add 2 teams, expand both, query `getByRole('button', { name: 'เพิ่มสมาชิก' })` — returns first card's button.
  - Suggested fix: add per-team `aria-label="เพิ่มสมาชิกในทีม {team.name}"` to button. Improves screen-reader UX too.

## Resolved

(none)
