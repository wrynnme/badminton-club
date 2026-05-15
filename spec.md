# Spec — ก๊วนแบด Tournament System

## Architecture

### Stack

- Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1
- Supabase Postgres (service role, bypass RLS) · MCP connected
- Auth: LINE Login + Guest (HMAC-signed `bc_session` cookie)

### Key Data Flow

- All writes → server actions (`src/lib/actions/`)
- DB queries use `createAdminClient()` (service role key)
- Revalidation via `revalidatePath()` after every write

---

## Current State

### Pair System (flat schema)

`pairs` table: `id, team_id, player_id_1, player_id_2, display_pair_name, pair_level, created_at`

- `pair_level` — auto-computed: `player1.level + player2.level` (sum, numeric) — no manual input
- `pair_code` column **removed** — use `pair.id` (UUID) as stable upsert key instead
- No junction table — players referenced directly on `pairs`

### Group Stage Division

- `matches.division` column: `upper | lower | null`
- `tournaments.pair_division_threshold` — configurable per tournament (numeric, nullable)
  - `null` = no division; all pairs play together
  - `pair_level > threshold` → upper; else → lower
- Cross-division matches only in knockout

### CSV Import (2-step)

**Step 1 — Players**

```
team, color, id_player*, display_name*, role, level
```

- Upsert by `id_player` (csv_id) — same id → update; new → insert
- Auto-creates teams if not exist

**Step 2 — Pairs**

```
team, pair_id, id_player_1*, id_player_2*, pair_name
```

- `pair_id` optional — UUID of existing pair for upsert; empty = new pair
- `pair_level` not in CSV — auto-computed from player levels on insert/update
- Upsert by `pair_id` (UUID) — found → update; empty → insert new
- Skip if exact player pair already exists
- Team validated via player membership (not `team` column)

### CSV Export

- **ผลแข่งขัน** — match results CSV
- **รายชื่อ** — roster with columns: ทีม, สี, id_player, ชื่อ, ตำแหน่ง, Level, pair_id, คู่, pair_level
- **Template ผู้เล่น** — blank player import template
- **Template จับคู่** — template with empty pair_id (new pairs), player csv_ids pre-filled

### Level Mapping (shared across player + pair)

- Player level: free numeric (`parseFloat`), stored on `team_players.level`
- Pair level: auto = `player1.level + player2.level` (sum); null if both players have no level

---

## Data Contracts

### `PairCsvRow`

```ts
{
  team: string;        // informational only
  pair_id: string;     // optional — UUID for upsert; empty = new pair
  id_player_1: string; // required — csv_id of player 1
  id_player_2: string; // required — csv_id of player 2
  pair_name: string;   // optional
  // pair_level omitted — auto-computed from player levels (sum)
}
```

### `PlayerCsvRow`

```ts
{
  team: string;         // required
  color: string;        // optional
  csv_id: string;       // required — stable upsert key (id_player column)
  display_name: string; // required
  role: "captain" | "member";
  level: string;        // optional
}
```

### `Match.division`

`"upper" | "lower" | null` — null = team-mode or undivided pair matches

---

## Done

- Phase 0–4: group stage, knockout (single + double elim), pair mode, CSV import/export, player level, flat pairs, player rename
- Phase 5: bracket visualization at `/tournaments/[id]/bracket`
- Phase 6: Realtime + public share link (`/t/[token]`)
- Phase 7a: LINE Notification + Print/PDF (see below)
- Phase 7b: Co-admin + Audit Log (see below)
- DB fixes: dropped `matches_winner_id_fkey` FK (was referencing `teams.id` — blocked pair mode winner), fixed `matches_round_type_check` + `matches_bracket_check` constraints to allow `upper/lower/grand_final`
- Code review fixes (committed with Phase 7a+7b):
  - `matches.ts` — `loserId` now `null` when `winner === "draw"` (was incorrectly routing team A as loser)
  - `pair-stage.tsx` — per-group open state; was shared `showMatches` collapsing all groups at once
  - `/t/[token]/page.tsx` — pass `pairDivisionThreshold` to `PairStage` (divisions were missing on public page)
  - `admins.ts` — `getCoAdminsAction` now requires `assertCanEdit` (was open to any authenticated user)
  - `permissions.ts` — `assertIsOwner`/`assertCanEdit` throw on DB error instead of returning false; `assertCanEdit` now single-query JOIN (was 2 round-trips)
  - `audit.ts` — `writeAuditLog` logs `console.error` on failure (was silently swallowed)
  - `edit-tournament-form.tsx` — replaced raw `<input type="checkbox">` with shadcn `<Checkbox>`
  - `print-button.tsx` — replaced raw `<button>` with shadcn `<Button>`
  - `tournaments.ts` — `importPlayersCsvAction` parallelized with `Promise.all` (was sequential per row)

### Phase 5 — Bracket Visualization

- `buildVisualBracket(matches, section)` → `VisualRound[]` (slot height = `CARD_H * 2^roundIdx`)
- `BracketView` — flex columns + CSS connector lines; horizontal scroll
- `BracketMatchCard` — competitors + score + winner highlight
- "ดูสาย" button in knockout-stage links to bracket page (no auth required)

### Phase 6 — Realtime + Share Link

- `tournaments.share_token` (UUID, unique nullable)
- `generateShareTokenAction` / `revokeShareTokenAction`
- `share-controls.tsx` — owner-only generate/copy/revoke
- `/t/[token]` — public read-only page, fetches by share_token, no auth
- `TournamentLiveWrapper` — Supabase Realtime `postgres_changes` on matches → `router.refresh()`; green LIVE badge

### Phase 7b — Co-admin + Audit Log

- **DB**: `tournament_admins` (PK: tournament_id + user_id (uuid → profiles.id), added_by (uuid → profiles.id), added_at) + `audit_logs` (id, tournament_id, actor_id, actor_name, event_type, entity_type, entity_id, description, created_at)
  - migration `tournament_admins_user_id_to_uuid`: backfilled LINE user_id text → profile UUID via `profiles.line_user_id` lookup; converted columns `user_id` + `added_by` `text → uuid` and added FK `→ profiles(id)` (user_id ON DELETE CASCADE; added_by ON DELETE SET NULL — column nullable)
- **Permission layer**: `src/lib/tournament/permissions.ts` — `assertIsOwner`, `assertCanEdit` (owner OR co-admin)
- **Audit helper**: `src/lib/tournament/audit.ts` — `writeAuditLog(params)` — inserts to `audit_logs` after every write
- **Co-admin actions**: `src/lib/actions/admins.ts` — `addCoAdminAction`, `removeCoAdminAction` (owner-only), `getCoAdminsAction`, `getAuditLogsAction` (owner + co-admin, limit 50)
- **All server actions updated**: `matches.ts`, `tournaments.ts`, `pairs.ts` — `assertCanEdit` for editable ops, `assertIsOwner` for share-token + structural changes
- **Co-admin UI**: `co-admin-controls.tsx` — owner-only Card; TanStack Form add by LINE user_id; list + remove
- **Audit log UI**: `audit-log-panel.tsx` — collapsible Card; fetches on first open; newest-first list
- **Page**: `canEdit = isOwner || isCoAdmin` — `TournamentStatusControl` + all edit components use `canEdit`; owner-only: `ShareControls` + `CoAdminControls`

#### Permission Matrix

| Action | isOwner | isCoAdmin |
|---|---|---|
| Record/reset scores | ✓ | ✓ |
| Add/edit/remove players | ✓ | ✓ |
| Manage teams/groups/bracket | ✓ | ✓ |
| Change tournament status | ✓ | ✓ |
| CSV export | ✓ | ✓ |
| Create/revoke share link | ✓ | ✗ |
| Add/remove co-admins | ✓ | ✗ |
| Update tournament settings | ✓ | ✗ |
| View audit log | ✓ | ✓ |

### Manual Match Creation (pair mode)

- **Action**: `createManualMatchAction({ tournamentId, pairAId, pairBId })` in `matches.ts`
  - Validates same division (computed from `pair_level` vs `pair_division_threshold`)
  - Inserts `round_type="group"`, `match_number=max+1`, `division` auto-computed
  - writeAuditLog `event_type="match_created"`
- **UI**: `manual-match-dialog.tsx` — Dialog + 2 Select dropdowns
  - Pair B options auto-filter to same division as Pair A
  - Shown in `pair-stage.tsx` "การแข่งขัน" header (canEdit, only when matches exist)
  - `PairStage` receives `pairDivisionThreshold` prop from page

### Pair mode `group_knockout` Knockout

- `generateKnockoutAction` supports pair mode with ALL formats now
- Seeds from `computeStandings()` after group stage
- No division: top `advance_count` pairs overall → single bracket
- With division: top `advance_count` from upper + lower → `buildIndependentDoubleBracket` (upper + lower + grand final)
- `knockout_only` pair mode: seed all pairs (no standings needed)

### UI Improvements

- Tournament detail page split into tabs: **ทีม · กลุ่ม* · คู่* · Knockout* · ตั้งค่า** (* conditional per format)
- `Loader2` spinner on all pending/loading buttons
- Error messages — Thai-friendly throughout; no raw `error.message` from DB exposed to UI
- Settings tab (owner-only): `edit-tournament-form.tsx` — TanStack Form pre-populated with current tournament data, calls `updateTournamentAction`

---

## Done (continued)

### Phase 7a — LINE Notification + Print/PDF

- **LINE notification**: `src/lib/notification/line.ts` — `notifyTournamentAdmins(tournamentId, text)` sends LINE push to owner + all co-admins
  - Env var: `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` (silently skipped if missing or no recipients have line_user_id)
  - Recipients: dedupe `[owner_id, ...tournament_admins.user_id]` (all profile UUIDs now), single `profiles.line_user_id IN (...)` lookup
  - Delivery: LINE `/push` for 1 recipient, `/multicast` for 2+ (up to 500 IDs per request)
  - Errors logged to `console.error` (API non-2xx + exceptions); no success/recipient logs (low noise)
  - Non-blocking: `.catch(() => {})` at the caller — never affects action result
  - **3 triggers**:
    | Trigger | Action | Message |
    |---|---|---|
    | Record match score | `recordMatchScoreAction` | `🏸 A vs B\nเกมที่ชนะ: 2:1 (21-15, 18-21, 21-19)\nผู้ชนะ: ชื่อ` |
    | Generate knockout bracket | `generateKnockoutAction` (2 code paths) | `สร้างสายน็อกเอาต์แล้ว` |
    | Tournament status change | `updateTournamentStatusAction` | `สถานะเปลี่ยนเป็น: <Thai label>` |
  - **Not triggered**: reset score, create/delete team/group/pair/match, add/remove co-admin, export/print, update tournament settings
- **Print pages**: `/tournaments/[id]/print/matches` + `/tournaments/[id]/print/roster` — server-rendered, print-optimized; nav hidden on print
- **Bracket print**: `src/components/ui/print-button.tsx` client component → `window.print()`; added to bracket page header
- **Export buttons**: added `tournamentId` prop + "พิมพ์:" section with match + roster links (open new tab)

### Version Badge

- **Build-time env injection** (`next.config.ts`):
  - `NEXT_PUBLIC_APP_VERSION` — read from `package.json` via `readFileSync` + `JSON.parse`
  - `NEXT_PUBLIC_GIT_COMMIT` — `execSync("git rev-parse --short HEAD")` with `try/catch` → `"unknown"` fallback (shallow CI clones)
- **UI**: `SiteHeader` shows outline `Badge` next to 🏸 ก๊วนแบด logo with `v{version} ({commit})` — `hidden sm:inline-flex` (mobile-hidden)

---

## Todo

- Phase 8 — (TBD)
