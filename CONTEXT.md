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
  real LINE account). A row becomes profile-linked in one of two ways: a **regular member**
  (ขาประจำ, seeded on session open) carries their linked profile in, or a **LINE link**
  (see below) attaches a profile to an *existing* guest row — which keeps its
  manager-curated `display_name` by default. A guest's `display_name` is always
  editable; a profile-linked player's name stays editable by a manager too.
- **Manager** — the club **owner** or a **co-admin** (`canManage` / `assertCanManageClub`).
  Only managers may add or edit roster players, manage the level catalog, or run LINE linking.
- **Site admin** — a system-wide operator (`profiles.is_site_admin`, gate in
  `src/lib/auth/site-admin.ts`) using the `/admin` page. Cross-club support powers
  (global level catalog, bot messages, LINE-group bindings) — NOT a Manager: a site
  admin's authority spans clubs but does not make them a member/manager of any club.
  Never shorten either role to just "admin"; the word is ambiguous in this domain.

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
- **Meet (เจอ)** — two players *meet* in one match when they share the court, whether
  as partners or as opponents. Per match a player meets `2·players_per_team − 1`
  others: doubles = 3 (one partner + two opponents), singles = 1 (the opponent).
- **Check-in gate** — สุ่มคิว draws only from **checked-in** roster players whenever
  at least one active player has checked in; if nobody has checked in, the whole
  active roster is eligible (safety fallback). Independent of `not_ready_action` —
  that setting governs the live per-court rotation, not the batch pool.
- **Suggested target (N)** — the recommended per-player game count so everyone meets
  everyone once, given **M** eligible (checked-in) players: `ceil((M−1) / meet-per-match)`.
  The floor value is the largest N that still guarantees *no repeat meeting*; the ceil
  value is the smallest N that *covers everyone* (its tail may repeat once). สุ่มคิว
  offers ceil as the default and shows the floor–ceil range.

## Bulk queue update (เลือกหลายแมตช์)

Design locked 2026-07-10 (grilled); **built in v0.27.0** — lets a manager act on many
matches at once in the club queue panel (`club-queue-panel.tsx`). The bulk-start
court allocator is the pure helper `planBulkStartCourts` (`src/lib/club/bulk-start.ts`).

- **Per-section select mode** — the `รอแข่ง` (pending) and `จบแล้ว` (completed)
  sections each get their own independent select mode + sticky bulk bar; the two
  selections never mix (mixed-status was deliberately excluded — `กำลังแข่ง`
  in_progress stays per-row only). Reuses the players-list pattern: header "เลือก"
  toggle → per-row `Checkbox` + select-all/indeterminate + a sticky `BulkActionBar`.
  Entering select mode **disables DnD** on pending (parity with `sortable-player-list`).
  The inline `BulkActionBar` from `sortable-player-list.tsx` is copied/generalized —
  it is not currently an exported shared component.
- **Pending bulk actions** — จัดสนาม (assign one chosen court to all selected;
  pending has no occupancy constraint so same-court-to-many is allowed) · ยกเลิก
  (soft, `status='cancelled'`) · เริ่มแข่ง (see auto-court below) · ลบถาวร (hard
  delete via `delete_club_match`, with a confirm dialog carrying the same
  games_played / last_finished_at caveat as the single-delete dialog).
- **Completed bulk action** — ลบถาวร only (same confirm + caveat).
- **Bulk-start auto-court** — the sharp edge (court-occupancy UNIQUE
  `(club_id,court) WHERE in_progress` + the `club_player_busy` trigger). Behavior:
  walk selected matches in queue order; a match keeps its own court if that court is
  free, else gets the next free court (a `clubs.courts` entry not held by an
  in_progress match nor already claimed earlier in this batch); skip a match that is
  not full, has a live placeholder, shares a player already started this batch, or
  finds no free court. Report `เริ่ม X · ข้าม Y` via **dedicated per-outcome toast
  keys** (never concatenated label keys).
- **Server actions** — new bulk actions in `club-matches.ts`
  (`bulkSetClubMatchCourtAction` / `bulkCancelClubMatchesAction` /
  `bulkStartClubMatchesAction` / `bulkDeleteClubMatchesAction`), each: one
  `assertCanManageClub(clubId)`, operate only on rows matching
  `.eq("club_id", clubId).in("id", matchIds)` filtered by the expected status (cross-club
  or wrong-status ids silently ignored), server-side `Promise.all`, a single
  `revalidatePath` at the end, and a per-item result shape (`{started, skipped}` /
  `{deleted, failed}` …). Cancel/delete keep **parity with the single actions** — they
  do not newly clear downstream `winner_next_match_id` feeder pointers (a pre-existing
  caveat, out of scope for this feature).

## Club series (ก๊วนถาวร + นัด)

Design locked 2026-07-15 (grilled, 15 decisions) and **BUILT**: P1 (LINE surfaces
resolve via series) shipped to prod v0.42.0; P2 (series home + จัดก๊วน + URL
restructure + preset retirement, v0.43.0), P3 (payment/receipt/co-admins lift —
migration-gated), and P4 (cross-session stats) implemented 2026-07-15 (PRs
pending merge). See ADR 0002 and `spec.md` § "📐 Design — ผูกครั้งเดียวใช้ได้ตลอด".
These terms supersede the "one `clubs` row = one club" reading used elsewhere
in this file.

- **Club series / ก๊วน (ถาวร)** — the persistent real-world club (e.g. "MUGGLE"): a
  `club_series` row owning the LINE group binding (`line_group_id`), the join link
  (`join_token`), the member registry, and (post-P3) payment config + co-admins.
  Bound to its LINE group **once, forever** — bindings never move between sessions.
- **Session / นัด** — one play meeting: a `clubs` row with `series_id` set. Roster,
  queue, matches, and billing stay per-session. Noun contexts always use "นัด"
  ("นัดปัจจุบัน", "ประวัตินัด", "นัดวันพุธ"). Never call a session "ก๊วน" in new copy.
- **จัดก๊วน (open a session)** — the **verb** on the primary action button that opens
  a new นัด (hybrid naming, 2026-07-15). Action-label only — never a noun for the
  session entity, to avoid stacking "ก๊วน" across both layers.
- **Member / สมาชิกก๊วน** — a `series_members` row: a person belonging to the series
  (manager-curated `canonical_name` + `default_level_id`), surviving every session.
  Two kinds: **LINE-linked** (`profile_id` set — reachable by push/mention; created
  the first time a manager confirms that person) and **name-only** (`profile_id`
  NULL — added by a manager, seeded normally, unreachable by push; upgrades in place
  when they link LINE). Distinct from a **roster player** (`club_players` =
  attendance of one นัด).
- **Regular / ขาประจำ** — a member with `is_regular = true` (default): auto-seeded
  into the roster when a session opens.
- **Partner pair / คู่ประจำ** — a series-level pair of members
  (`series_partner_pairs`) instantiated into per-session `club_locked_pairs` on
  session open. The queue engine still reads only per-session locked pairs.
- **Active session / นัดปัจจุบัน** — the session `club_series.active_session_id`
  points at; set automatically on open, switchable by a manager. Webhook keyword
  linking and join-link auto-link target this session's roster. Membership upserts
  are series-level regardless.
- **Membership request** — the evolution of a **link request**: `club_link_requests`
  becomes series-scoped (join a ก๊วน once, not each นัด). Returning confirmed
  members auto-link on exact+unique name match (amends ADR 0001 — see ADR 0002);
  first-timers still require one manager confirmation.
- **Ad-hoc club / ก๊วนเฉพาะกิจ** — a one-off group (plays once or twice): a hidden
  auto-created `club_series` with `is_adhoc = true` (name optional) wrapping its
  session(s), so LINE binding/join/billing use the same series-level machinery.
  Listed compactly as "เฉพาะกิจ", not as a full ก๊วน. Upgrading to a full ก๊วน =
  naming it and flipping the flag — nothing moves.
- **Session defaults / ค่าตั้งต้นนัด** — `club_series.session_defaults` jsonb (venue,
  times, max_players, court/shuttle fees, full queue_settings, named courts) edited
  on the club settings page. "จัดก๊วน" always reads it; editing one นัด never writes
  back. The living successor of the retired club-preset system.

## LINE linking (เชื่อม LINE)

Design locked 2026-07-11 (grilled). Attaches a real LINE account to an existing
**guest** roster player so outbound pushes (bills, notifications) reach them —
closing the `skippedNoLine` gap in club billing. v1 is **outbound-only and
club-only**; the tournament roster (`team_players`) is out of scope (no consumer).
See ADR 0001.

- **LINE link (เชื่อม)** — the manager action that attaches a profile to an existing
  guest `club_players` row by setting its `profile_id`. Distinct from a **Meet** and
  from a **club_match** (a game) — "link" never refers to a badminton match. The UI
  verb is "จับคู่ LINE". A link is manager-confirmed, never automatic.
- **Join link (ลิงก์เข้าร่วมก๊วน)** — a per-club stable token (`clubs.join_token`,
  unique/nullable, mirrors `tournaments.share_token`) that a manager generates and
  shares. A player who opens it and logs in with LINE places their profile into the
  club's **link pool**. Distinct from `share_token`, which grants public read-only
  view of a tournament — a join link instead *collects* a would-be member.
- **Link request (คำขอเชื่อม)** — a `club_link_requests` row: a profile that opted
  into a club via the join link and awaits a manager to link it. `status` is
  `pending` | `matched` | `rejected`; `UNIQUE(club_id, profile_id)` makes a repeat
  login idempotent (upsert), never a duplicate.
- **Link pool / รอจับคู่** — the set of `pending` link requests for a club, shown to
  managers with each profile's LINE name + picture. A manager either **links** a
  request to a guest row or **dismisses** it (`status = rejected`) — e.g. a stranger
  who opened the link.
- **Name-on-link choice** — when a manager links, a dialog asks whether the roster
  `display_name` stays the manager-curated name (default) or adopts the LINE account
  name. The identity on the roster is the club's, not LINE's, unless the manager opts
  in.
- **Self-service keyword link (เชื่อมเองในกลุ่ม)** — a player links themselves by
  @mentioning the bot in the club's bound LINE group and typing
  `เชื่อมไลน์ <ชื่อในโพย>`. A clean **unique** match on a still-guest row auto-links
  immediately — the one exception to "a link is manager-confirmed, never automatic";
  any ambiguous / already-linked / not-found case drops into the **link pool** for a
  manager instead. A fast-path *alongside* the join-link pool (v0.34.0), not a
  replacement. The roster `display_name` is always preserved (no name-choice dialog).
