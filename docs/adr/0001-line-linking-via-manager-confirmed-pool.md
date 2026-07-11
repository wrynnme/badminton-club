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
