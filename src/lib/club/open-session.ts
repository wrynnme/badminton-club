import type { ClubSeries, SeriesMember } from "@/lib/types";
import { SESSION_FALLBACKS, type SessionDefaults } from "@/lib/club/session-defaults";

/**
 * open-session.ts — PURE builders for "จัดก๊วน" (ADR 0002 decisions #2/#6/#15):
 * turning a `club_series` + its parsed `session_defaults` + membership registry
 * into the insert payloads for a brand-new `clubs` session row, its seeded
 * roster, and its seeded locked pairs. No I/O — every DB read/write + rollback
 * lives in the server action (`src/lib/actions/club-series.ts`) so this module
 * stays trivially unit-testable.
 */

/** clubs-table insert payload for a freshly-opened session. */
export function buildSessionInsert(args: {
  series: Pick<ClubSeries, "id" | "name" | "owner_id">;
  defaults: SessionDefaults;
  playDate: string;
}): Record<string, unknown> {
  const { series, defaults, playDate } = args;
  return {
    name: series.name,
    owner_id: series.owner_id,
    series_id: series.id,
    play_date: playDate,
    venue: defaults.venue ?? SESSION_FALLBACKS.venue,
    start_time: defaults.start_time ?? SESSION_FALLBACKS.start_time,
    end_time: defaults.end_time ?? SESSION_FALLBACKS.end_time,
    max_players: defaults.max_players ?? SESSION_FALLBACKS.max_players,
    court_fee: defaults.court_fee ?? 0,
    shuttle_price: defaults.shuttle_price ?? 0,
    court_split: defaults.court_split ?? "even",
    shuttle_split: defaults.shuttle_split ?? "even",
    courts: defaults.courts ?? [],
    queue_settings: defaults.queue_settings,
  };
}

export type SeriesMemberForSeed = Pick<
  SeriesMember,
  "id" | "profile_id" | "canonical_name" | "default_level_id" | "is_regular" | "first_linked_at"
>;

export type RosterSeedRow = {
  display_name: string;
  profile_id: string | null;
  member_id: string;
  level_id: string | null;
  position: number;
  status: "active" | "reserve";
};

/**
 * Regulars auto-seed the roster (decision #2), ordered by `first_linked_at`
 * asc (ties broken by name for determinism) — overflow beyond `maxPlayers`
 * becomes 'reserve'. Non-regular members are never auto-seeded.
 */
export function buildRosterSeedRows(args: {
  members: SeriesMemberForSeed[];
  maxPlayers: number;
}): RosterSeedRow[] {
  const regulars = args.members
    .filter((m) => m.is_regular)
    .slice()
    .sort((a, b) => {
      const byLinked = a.first_linked_at.localeCompare(b.first_linked_at);
      return byLinked !== 0 ? byLinked : a.canonical_name.localeCompare(b.canonical_name);
    });

  return regulars.map((m, idx) => ({
    display_name: m.canonical_name,
    profile_id: m.profile_id,
    member_id: m.id,
    level_id: m.default_level_id,
    position: idx + 1,
    status: idx < args.maxPlayers ? "active" : "reserve",
  }));
}

export type SeriesPairForSeed = { id: string; member1_id: string; member2_id: string };
export type LockedPairSeedRow = { player1_id: string; player2_id: string; games_remaining: null };

/**
 * Instantiate series-level partner pairs (decision #6) into per-session locked
 * pairs — only when BOTH members were seeded into THIS session's roster (see
 * `buildRosterSeedRows`'s output, keyed by `playerIdByMemberId`). A member
 * skipped this session (not `is_regular`, or the roster insert otherwise
 * omitted them) drops its pair entirely rather than seeding a half pair.
 *
 * A member can end up referenced by more than one `series_partner_pairs` row
 * (e.g. after a manual re-pair without cleaning up the old one) — the first
 * pair encountered wins (mirrors `club_locked_pairs`' one-active-lock-per-player
 * invariant); any later pair naming an already-claimed member is dropped.
 */
export function buildLockedPairRows(args: {
  pairs: SeriesPairForSeed[];
  playerIdByMemberId: Map<string, string>;
}): LockedPairSeedRow[] {
  const claimed = new Set<string>();
  const rows: LockedPairSeedRow[] = [];

  for (const pair of args.pairs) {
    if (claimed.has(pair.member1_id) || claimed.has(pair.member2_id)) continue;
    const player1Id = args.playerIdByMemberId.get(pair.member1_id);
    const player2Id = args.playerIdByMemberId.get(pair.member2_id);
    if (!player1Id || !player2Id) continue;

    claimed.add(pair.member1_id);
    claimed.add(pair.member2_id);
    rows.push({ player1_id: player1Id, player2_id: player2Id, games_remaining: null });
  }

  return rows;
}
