# CONTEXT — Ubiquitous language (ก๊วนแบด / kuanbad)

Glossary only — the shared vocabulary for this codebase. No implementation details;
those live in `spec.md`. Keep terms precise so code, UI copy, and docs agree.

## Skill levels

- **Level** — a catalog entry in the `levels` table: a numeric `real` (the value
  matchmaking math uses) plus a display `label` (e.g. `BG`, `N-`, `P`). Levels are
  either **global** (`club_id IS NULL` — the default ladder, also used by
  tournaments) or **club-scoped** (`club_id = <uuid>` — a club's own customized
  ladder). A club gets its own set on first customization via copy-on-first-write
  (`clone_global_levels_to_club`).
- **Active level set** — the set of Levels in force for a club: its club-scoped rows
  if it has customized, otherwise the global rows. A player's level must belong to
  this set. Resolved by `resolveActiveLevelIds` (`src/lib/club/levels.ts`).
- **Player's assigned level** — `club_players.level_id` (FK → `levels`, `ON DELETE
  SET NULL`). Set by owner/co-admin when adding a guest and editable afterward
  (quick-select in the roster row, the edit-player form, or the bulk dialog).
- **"ไม่มีระดับ" (no level)** — `level_id = NULL`. In the UI, Radix/Base UI Selects
  can't hold an empty value, so the sentinel string `__none__` stands in for it and
  is mapped back to `NULL` at the server-action boundary.

Note: `team_players.level_id` (the **tournament** roster) is a separate table that
uses only the **global** level set — do not conflate it with club `level_id`.

## Roster (club)

- **Roster player** — a `club_players` row. Either a **guest** (`profile_id IS
  NULL`, name-only, added by a manager) or **profile-linked** (`profile_id` set — a
  real LINE account, e.g. via preset regulars). A guest's `display_name` is editable;
  a profile-linked player keeps their LINE account name.
- **Manager** — the club **owner** or a **co-admin** (`canManage` / `assertCanManageClub`).
  Only managers may add or edit roster players or manage the level catalog.

## Club presets

- **Club preset** — a user-owned reusable template for opening a new club session.
  It stores setup data and regular roster defaults, not live runtime state. Applying a
  preset creates a new independent club.
- **Snapshot config** — the config captured from an existing club when a manager
  saves it as a preset. It copies only fields the preset schema supports; it does not
  copy matches, current queue state, payment status, slips, or verification secrets.
- **Payment receiver** — the receiver details copied by presets for collecting
  money: PromptPay id/name, an optional existing QR image URL, bank receiver details,
  and which payment channels a receipt should show.
- **Receipt theme** — the preset-supported receipt presentation choice copied with
  payment receiver settings. It is intentionally narrower than the full receipt
  template: footer text, line-item visibility, and receipt logo are not part of the
  preset payment receiver snapshot.

## Batch queue (สุ่มคิว)

- **Batch queue / สุ่มคิว** — one press generates the session's whole set of pending
  matches so every eligible player reaches their pro-rated minimum of **N** fixed
  appearances. Generated matches are **courtless** (`club_matches.court = NULL`)
  until a manager assigns a court; a match cannot start without one.
- **Pro-rated target** — a player's personal minimum: N scaled by the fraction of
  the club session they are present (declared start/end → check-in time → full
  session), floored at 1. Late arrivals get proportionally fewer guaranteed games.
- **Top-up** — re-pressing สุ่มคิว counts every existing fixed appearance
  (pending + playing + finished) and generates only the shortfall. Never deletes.
- **Lane (เลน)** — winner-stays generation splits into court-count parallel chains.
  A lane is court-agnostic until courts are assigned.
- **Winner placeholder (ผู้ชนะจากคิวที่ N)** — an empty match side wired to a feeder
  match via `winner_next_match_id`/`winner_next_match_slot`. When the feeder
  completes with a winner, `finish_club_match` copies the winning side in — unless
  a manager already filled the side by hand (manual edits always win).
- **Re-roll (จัดคิวใหม่)** — per-match button that re-picks a pending match's fixed
  players from the freshest pool, keeping court, queue position and placeholders.
