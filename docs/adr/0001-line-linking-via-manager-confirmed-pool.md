# 0001 — LINE linking via a manager-confirmed pool

- **Status**: Accepted (2026-07-11, grilled)
- **Scope**: Club side only (`club_players`). Tournament roster (`team_players`) excluded.

## Context

Guest roster players (`club_players.profile_id IS NULL`) are **unreachable by LINE
push**. Every push channel resolves `club_players.profile_id → profiles.line_user_id`,
so club billing (`pushClubBillsAction`) counts guests as `skippedNoLine` and skips
them. The goal ("เชื่อมผู้เล่นเข้ากับ LINE") is to attach a real LINE account to an
existing guest row so bills and notifications reach that player.

Constraints discovered by reading the code before designing:

- `club_players.profile_id` is already a nullable FK with `UNIQUE(club_id, profile_id)`,
  but **every add path leaves it NULL** — no current flow links a player.
- A manager cannot obtain a raw LINE `userId` (opaque `U…`), and there is **no
  enumerable source of profiles** to pick from: the only profile↔club relations are
  `club_admins` and already-linked `club_players`. `profiles.line_user_id` is PII and
  never shipped to the client.
- The **inbound LINE webhook is a signature-verified no-op** — no event→entity
  mapping exists. Building bot-driven linking would mean building inbound processing
  and a code-issuing scheme from scratch.
- LINE Login (OAuth + LIFF) already mints a session carrying `profileId`.

## Decision

Link through a **manager-confirmed pool**, reusing LINE Login and touching no webhook:

1. A club has one stable **join link** (`clubs.join_token`, mirrors
   `tournaments.share_token`). The manager shares it (e.g. in the club's LINE group).
2. A player opens it and logs in with LINE. That **proves ownership** of the LINE
   account and inserts a `pending` row into a new **`club_link_requests`** table
   (`club_id`, `profile_id`, `status`, `created_at`; `UNIQUE(club_id, profile_id)` so a
   repeat login is an idempotent upsert, never a duplicate).
3. The manager sees the **pool** of pending requests (LINE name + picture) and **links**
   each to an existing guest row — setting `club_players.profile_id`, marking the
   request `matched`, and firing a fire-and-forget confirmation push to the player. A
   dialog asks whether the roster `display_name` keeps the manager-curated name
   (default) or adopts the LINE name. Unwanted requests are **dismissed** (`rejected`).
4. Guards: linking a profile already linked in the club is rejected ("ผูกกับ X แล้ว");
   already-linked rows are excluded from the link target list; **unlink** sets
   `profile_id` back to NULL and returns the request to `pending`.

v1 is **outbound-only**: it wires no new player-facing surface beyond the join page's
"request received / already linked" states.

## Alternatives considered

- **Direct per-player claim link** (a link bound to one guest row; whoever logs in is
  auto-attached). Simpler — no pool, no manual match — but removes the manager from the
  loop, so a mis-shared link silently attaches the wrong LINE account to a named player,
  and there is no gate against strangers. Rejected: the manager must own the final
  identity mapping.
- **Manager picks from a list of known profiles.** There is no such list for genuine
  guests — it would only ever contain the managers themselves, so it cannot fulfil the
  goal. Rejected.
- **Bot-driven linking** (player messages the bot a code → webhook links). The most
  "native" LINE UX, but requires building inbound webhook processing and a code scheme
  from a current no-op. Rejected for v1 as disproportionate to an outbound-only goal;
  revisitable if inbound is built for other reasons.

## Consequences

- **New durable state**: `club_link_requests` table + `clubs.join_token`. A public
  `/clubs/join/[token]` route that requires LINE Login. New manager-only surface in the
  club detail page (join-link controls + pool + link/dismiss), plus an unlink control in
  each linked player's edit dialog on the check-in roster (any row whose `profile_id` is
  set — guests-turned-linked and preset regulars alike).
- **Privacy**: only players who opt in by logging into *this* club appear to the
  manager; `line_user_id` stays server-side. A leaked join link at worst lets strangers
  sit in the pool — the manager dismisses them, and the token is revocable.
- **Reuse**: LINE Login, `getSession`, `pushTextToUser`, and the `share_token`+QR idiom
  are reused; the inbound webhook is untouched.
- **Deferred**: tournament-side linking, self-service player surfaces, and realtime pool
  updates (the manager refreshes / the action revalidates) are out of v1 scope.

## Addendum (2026-07-11): second entry point — link a known profile from the edit form

The pool answers "a player *this* club scanned wants in." It does **not** cover the
common case where a manager runs several clubs and the player already scanned a
*different* one of theirs — the manager knows exactly who this guest is but the pool for
this club is empty, so they'd have to ask the player to scan again.

The addition: a "เชื่อม LINE" button in the guest row's edit dialog opens a picker of
**known profiles** — anyone with a `club_link_requests` row in *any* club the manager
owns or co-admins (any status), minus profiles already linked in this club. The manager
picks one and links directly (`linkKnownProfileAction`), skipping the pool.

- **Consent scope decision**: consent flows from the player having opted into the
  manager's *ecosystem* (any of their clubs), not strictly into this one club. Rationale:
  the player already handed this manager their LINE identity by scanning; attaching them
  to another of the same manager's rosters exposes no new PII (still only
  `display_name`/`picture_url` client-side, `line_user_id` server-only) and matches how a
  real club owner reuses a known member across their weekly sessions. The trade-off
  (linking a profile that scanned a sibling club, not this one) is deliberate and is why
  the consent predicate is re-verified server-side in `linkKnownProfileAction` — a
  `profileId` with no request in the manager's clubs is rejected, so the picker's scope is
  a hard authorization boundary, not just a UI filter.
- **No new durable state**: reuses `club_link_requests`, the guest-target/already-linked
  guards, the `uniq_club_players_profile` index, and the confirm push. A pending pool
  request for the same profile in this club is retired to `matched` on link. No migration.
