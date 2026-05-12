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

`pairs` table: `id, team_id, player_id_1, player_id_2, display_pair_name, pair_level, pair_code, created_at`

- `pair_code` — stable user-defined ID (e.g. `R1-P1`), used for upsert on re-import
- `pair_level` — S/A/B/C/D/N; drives division split (levelToNum > 2 → กลุ่มบน)
- No junction table — players referenced directly on `pairs`

### Group Stage Division

- `matches.division` column: `upper | lower | null`
- `generatePairMatchesAction` splits pairs by `pair_level`:
  - B/A/S (levelToNum > 2) → upper
  - C/D/N or unset → lower
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
team, pair_code*, id_player_1*, id_player_2*, pair_name, pair_level
```

- `pair_code` required
- Upsert by `pair_code` — same code → update players/name/level; new → insert
- Skip if player pair already exists (without pair_code)
- Team validated via player membership (not `team` column)

### CSV Export

- **ผลแข่งขัน** — match results CSV
- **รายชื่อ** — roster with columns: ทีม, สี, id_player, ชื่อ, ตำแหน่ง, Level, pair_code, คู่, pair_level
- **Template ผู้เล่น** — blank player import template
- **Template จับคู่** — pre-filled pair template with auto-generated pair_codes from player csv_ids

### Level Mapping (shared across player + pair)

`5, 4, 3, 2, 1, 0` — free-text also supported (numeric string → parseFloat)

---

## Done

- Phase 0–4: group stage, knockout (single + double elim), pair mode, CSV import/export, player level, flat pairs, player rename
- `pair_code` — stable ID for pair upsert on re-import
- `pair_level` — explicit pair level (replaces computed sum of player levels for division)
- `division` column on matches — upper/lower split at group stage
- `team` column in pair CSV — informational, for readability

---

## Data Contracts

### `PairCsvRow`

```ts
{
  team: string; // informational only
  pair_code: string; // required — stable upsert key
  id_player_1: string; // required — csv_id of player 1
  id_player_2: string; // required — csv_id of player 2
  pair_name: string; // optional
  pair_level: string; // optional — S/A/B/C/D/N
}
```

### `PlayerCsvRow`

```ts
{
  team: string; // required
  color: string; // optional
  csv_id: string; // required — stable upsert key (id_player column)
  display_name: string; // required
  role: "captain" | "member";
  level: string; // optional
}
```

### `Match.division`

`"upper" | "lower" | null` — null = legacy/team-mode matches

---

## Todo

- Phase 5 — Bracket visualization (`/tournaments/[id]/bracket`)
- Phase 6 — Realtime + public share link (`/t/[token]`)
- Phase 7 — LINE notification + PDF export
