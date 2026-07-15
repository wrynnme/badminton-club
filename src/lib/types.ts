import type { BotMessageKey } from "@/lib/bot-messages";

export type Profile = {
  id: string;
  line_user_id: string | null;
  display_name: string;
  picture_url: string | null;
  is_guest: boolean;
  is_site_admin: boolean; // single site owner who edits global settings (/admin)
  created_at: string;
};

// Global, site-wide settings (singleton row, id=1). Edited only by a site admin.
export type AppSettings = {
  qr_logo_enabled: boolean;
  qr_logo_url: string | null; // null = bundled default (/thaiqr-logo.png)
  // Site-admin overrides for the bot's automated LINE messages. A key present
  // here (non-blank) replaces the code default for that message; missing keys
  // fall back to the built-in default (see @/lib/bot-messages).
  messages: Partial<Record<BotMessageKey, string>>;
};

export type Club = {
  id: string;
  owner_id: string;
  name: string;
  venue: string;
  play_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
  total_cost: number | null;
  shuttle_info: string | null;
  notes: string | null;
  created_at: string;
  // Cost split (per-bucket, independently configurable)
  court_fee: number;
  court_split: CourtSplit;
  shuttle_split: ShuttleSplit;
  shuttle_price: number; // price per shuttle — drives cost for all shuttle_split modes
  // Per-hour shuttle COUNT, one entry per 1-hour session slot (slot order from
  // sessionHourSlots(start_time,end_time)). Used only when shuttle_split="by_time".
  shuttle_hourly: number[];
  // Manual total shuttle count for shuttle_split="even" (0 = derive from match
  // shuttles_used — i.e. count from actual games played).
  shuttle_total: number;
  court_gap_policy: GapPolicy;
  // Rotation-queue config (raw jsonb; parse via parseQueueSettings in queue-settings.ts)
  queue_settings: Record<string, unknown>;
  // Named courts (mirror tournaments.courts); replaces queue_settings.court_count.
  courts: string[];
  // Visibility: false = manager-only (default); true = public read-only at /c/[id]
  // (cost/money hidden from public viewers). Toggled by the owner.
  is_public: boolean;
  // Payment collection (PromptPay). Manager shows a per-player QR (amount embedded)
  // for in-person collection; null = not configured. promptpay_id = mobile / national ID.
  promptpay_id: string | null;
  promptpay_name: string | null;
  promptpay_qr_image: string | null; // uploaded QR image URL (alternative to promptpay_id)
  // Per-club receipt customization (#11/#12; raw jsonb, parse via parseReceiptTemplate
  // in club/receipt.ts). Default {} → DEFAULT_RECEIPT_TEMPLATE (current slip layout,
  // PromptPay only). receipt_logo_url = uploaded header logo (mirror promptpay_qr_image).
  receipt_template: Record<string, unknown>;
  receipt_logo_url: string | null;
  // Per-club LINE-linking join token (mirror tournaments.share_token). A manager shares
  // it; a player who opens /clubs/join/[token] and logs in drops a pending link request
  // into the pool. null = no join link generated. See docs/adr/0001.
  join_token: string | null;
  // Bound LINE group chat id (C…) for group billing (push bill+QR+@mentions into
  // the group, bucketed by amount). Captured when a manager posts the bind command
  // + join_token in the group (LINE only exposes groupId via webhook). null = not
  // bound. Enforced unique across clubs via uniq_clubs_line_group_id.
  // DEPRECATED (ADR 0002, P1): the LIVE binding lives on club_series.line_group_id
  // now — the webhook only writes here for a club with no series (should not exist
  // post-backfill). Kept readable as a fallback (see resolveLineGroupId); dropped
  // at CONTRACT.
  line_group_id: string | null;
  // Club series (ก๊วนถาวร — ADR 0002) this session (นัด) belongs to. Nullable only
  // for not-yet-migrated legacy rows — see ensureSeriesForClub, which lazily
  // attaches/creates one on first need (mirrors the backfill's (owner_id, name) rule).
  series_id: string | null;
};

// A persistent club entity (ก๊วนถาวร — ADR 0002 / docs/adr/0002) above per-session
// `clubs` rows: owns the LINE group binding + join link "once, forever", the member
// registry, and (post-P3) payment config/co-admins. RLS-on no-policy (service-role
// only, like every club table). See src/lib/club/series.server.ts.
export type ClubSeries = {
  id: string;
  owner_id: string;
  name: string;
  line_group_id: string | null;
  join_token: string | null;
  // "นัดปัจจุบัน" pointer (decision #3) — the session webhook keyword-link +
  // join-link auto-link target. Null only transiently (e.g. the pointed session
  // was deleted without a manual switch).
  active_session_id: string | null;
  is_adhoc: boolean;
  archived_at: string | null;
  // Explicit session defaults (decision #15) — venue/times/fees/queue_settings/
  // courts. "จัดก๊วน" (P2) reads this; per-session edits never write back.
  session_defaults: Record<string, unknown>;
  created_at: string;
};

// A series-level member registry row (สมาชิกก๊วน — decision #11): survives every
// session, unlike a `club_players` roster row (attendance of one นัด).
// profile_id NULL = a name-only member (no LINE, added by a manager) — first-class,
// upgrades in place when they later link LINE (see upsertSeriesMember).
export type SeriesMember = {
  id: string;
  series_id: string;
  profile_id: string | null;
  canonical_name: string;
  default_level_id: string | null;
  is_regular: boolean;
  first_linked_at: string;
  last_linked_at: string;
};

// Skill level lookup (real numeric for math, label for display, e.g. real 2 = "N").
export type Level = {
  id: string;
  real: number;
  label: string;
  sort_order: number;
  created_at: string;
  club_id: string | null; // NULL = global default; UUID = club-specific override
};

export type CourtSplit = "even" | "by_time";
export type ShuttleSplit = "even" | "per_match" | "per_player" | "by_time";
export type GapPolicy = "spread" | "owner" | "ignore";

export type ClubPlayer = {
  id: string;
  club_id: string;
  profile_id: string | null;
  display_name: string;
  level_id: string | null; // FK → levels (skill level)
  note: string | null;
  joined_at: string;
  position: number | null;
  status: "active" | "reserve"; // 'reserve' = waitlist beyond max_players; auto-promoted when an active player leaves
  checked_in_at: string | null;
  // Cost split inputs — per-player session window + games played
  start_time: string | null; // "HH:MM:SS" or null = use club window
  end_time: string | null;
  games_played: number; // auto-derived: finish_club_match RPC does +1, delete_club_match −1 (floor 0); no manual entry
  last_finished_at: string | null; // ISO; rest-ordering input for queue_mode='rest_longest'
  discount: number; // per-player discount subtracted from the cost-breakdown grand total
  paid_at: string | null; // ISO when the player paid (null = unpaid); set by manager during collection
  bill_amount: number | null; // amount snapshotted when the LINE bill was pushed
  paid_method: "promptpay_slip" | "manual" | null; // how paid_at was set
  bill_pushed_at: string | null; // ISO; null = bill not pushed
  // Series membership (ADR 0002, P1) this attendance row is stamped from once a
  // LINE link succeeds (manager-confirmed, self-service keyword, or decision #4
  // auto-link) — null for walk-ins with no membership. Never rekeyed off; the
  // roster still keys everything by club_id/id as before.
  member_id: string | null;
};

// A pending LINE-link request as shown to a manager in the pool: a profile that opted
// into a club via its join link, awaiting a manager to link it to a guest club_players
// row. Only the fields the pool UI needs (the link dialog acts by request id). Neither
// line_user_id (PII) nor profile_id (unused by the UI) reaches the client. See docs/adr/0001.
export type ClubLinkPoolRequest = {
  id: string;
  profile: Pick<Profile, "id" | "display_name" | "picture_url">;
  // decision #4 badge (ADR 0002, P1): set when this requester is already a
  // `series_members` row of the club's series — the manager sees they're a
  // returning member (with their prior canonical_name) rather than a stranger,
  // even though this particular request needed a manager because the auto-link
  // name match was ambiguous / not clean. null = not a known series member.
  member: { canonicalName: string } | null;
};

// A profile a manager may link WITHOUT a fresh scan: it already opted into one of the
// manager's own clubs (any club_link_requests row, any status) and is NOT yet linked to
// a roster row in the current club. Powers the "เชื่อม LINE" picker inside the guest
// edit form. Only public profile fields reach the client — line_user_id stays server-side.
export type LinkableKnownProfile = Pick<Profile, "id" | "display_name" | "picture_url">;

// Locked pair: two players forced to be teammates by the rotation queue.
// games_remaining is an IMMUTABLE quota, not a live counter: null = forever;
// N = the pair should play at most N games together in total. Live "remaining"
// is DERIVED at read time (quota − matches already pairing them, so removing a
// match refunds the slot) — see deriveLockBudgets in lib/club/batch-queue.ts.
export type ClubLockedPair = {
  id: string;
  club_id: string;
  player1_id: string;
  player2_id: string;
  games_remaining: number | null;
  created_at: string;
};

export type ClubMatchStatus = "pending" | "in_progress" | "completed" | "cancelled";

// Live rotation-queue match. side_*_player2 null = singles (players_per_team=1).
// All four player slots are nullable: a partial-roster match (organizer reserves a
// court with as few as 1 player, fills the rest later) leaves the empty slots null
// until edited. A match can't be STARTED until full (isClubMatchFull guard).
export type ClubMatch = {
  id: string;
  club_id: string;
  // Named court (FK-by-name to clubs.courts); was int 1..N pre-2026-06-08.
  // null = batch-generated match not yet assigned a court (can't start until set).
  court: string | null;

  side_a_player1: string | null;
  side_a_player2: string | null;
  side_b_player1: string | null;
  side_b_player2: string | null;
  status: ClubMatchStatus;
  // Winner forward-pointer (mirror of matches.next_match_id/next_match_slot):
  // when THIS match completes with a winner, finish_club_match copies the winning
  // side's player ids into the target match's side `winner_next_match_slot` —
  // only if that side is still fully empty (a manual edit always wins).
  winner_next_match_id: string | null;
  winner_next_match_slot: "a" | "b" | null;
  shuttles_used: number; // shuttles consumed by this match (for shuttle_split="per_match")
  queue_position: number | null;
  winner_side: "a" | "b" | null;
  score_a: number | null; // legacy single-set points; new rows leave null and use `games`
  score_b: number | null;
  games: Game[]; // per-set detail [{a,b}, …]; [] = winner-only / no-result / legacy row
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type TournamentMode = "sports_day" | "competition";
export type TournamentStatus = "draft" | "registering" | "ongoing" | "completed";
export type TournamentFormat = "group_only" | "group_knockout" | "knockout_only";
export type SeedingMethod = "random" | "by_group_score";
export type TeamRole = "captain" | "member";
export type MatchUnit = "team" | "pair";
export type MatchFormat = "fixed_2" | "best_of_3" | "best_of_5";

// Phase 13 — competition mode: event-scoped class (NB/BG/N/S/P-…). Carries the
// per-class grouping/format config that sports_day expresses at tournament level.
export type TournamentClass = {
  id: string;
  tournament_id: string;
  code: string;
  name: string;
  pair_capacity: number | null;
  pairs_per_group: number;
  format: TournamentFormat;
  advance_count: number;
  has_lower_bracket: boolean;
  allow_drop_to_lower: boolean;
  match_format: MatchFormat;
  position: number;
  created_at: string;
};

export type Tournament = {
  id: string;
  owner_id: string;
  name: string;
  venue: string | null;
  start_date: string | null;
  end_date: string | null;
  mode: TournamentMode;
  status: TournamentStatus;
  format: TournamentFormat;
  match_unit: MatchUnit;
  has_lower_bracket: boolean;
  allow_drop_to_lower: boolean;
  seeding_method: SeedingMethod;
  team_count: number;
  advance_count: number;
  pair_division_thresholds: number[];
  share_token: string | null;
  courts: string[];
  prize_template: PrizeTemplateEntry[];
  settings: Record<string, unknown>;
  notes: string | null;
  created_at: string;
};

// One configurable award tier shown on the prize-summary page. `rank` is the
// placement (1 = champion); `cash`/`trophy` are display-only ceremony metadata.
export type PrizeTemplateEntry = {
  rank: number;
  label: string;
  cash: number;
  trophy: boolean;
};

export type Team = {
  id: string;
  tournament_id: string;
  name: string;
  color: string | null;
  seed: number | null;
  created_at: string;
};

export type TeamPlayer = {
  id: string;
  team_id: string;
  profile_id: string | null;
  display_name: string;
  role: TeamRole;
  level_id: string | null; // FK → levels (skill level); source of truth for tournament players
  levels?: { real: number | string } | null; // optional FK embed (levels:level_id(real)) — present only when a query joins it
  csv_id: string | null;
  checked_in_at: string | null;
  created_at: string;
};

export type MatchRoundType = "group" | "knockout" | "upper_qf" | "upper_sf" | "upper_final" | "lower_qf" | "lower_sf" | "lower_final" | "grand_final";
export type MatchStatus = "pending" | "in_progress" | "completed";

export type Group = {
  id: string;
  tournament_id: string;
  class_id: string | null;
  name: string;
  created_at: string;
};

export type GroupTeam = {
  group_id: string;
  team_id: string;
  position: number | null;
  wins: number;
  draws: number;
  losses: number;
  points_for: number;
  points_against: number;
};

export type Game = { a: number; b: number };

export type BracketType = "upper" | "lower" | "grand_final";

export type Match = {
  id: string;
  tournament_id: string;
  group_id: string | null;
  class_id: string | null;
  round_type: MatchRoundType;
  round_number: number;
  match_number: number;
  team_a_id: string | null;
  team_b_id: string | null;
  pair_a_id: string | null;
  pair_b_id: string | null;
  team_a_score: number | null;
  team_b_score: number | null;
  games: Game[];
  winner_id: string | null;
  status: MatchStatus;
  court: string | null;
  scheduled_at: string | null;
  next_match_id: string | null;
  next_match_slot: "a" | "b" | null;
  loser_next_match_id: string | null;
  loser_next_match_slot: "a" | "b" | null;
  bracket: BracketType | null;
  division: string | null;
  queue_position: number | null;
  started_at: string | null;
  created_at: string;
};

export type Pair = {
  id: string;
  team_id: string;
  class_id: string | null;
  player_id_1: string | null;
  player_id_2: string | null;
  display_pair_name: string | null;
  pair_level: string | null;
  created_at: string;
};

export type PairWithPlayers = Pair & {
  player1: TeamPlayer | null;
  player2: TeamPlayer | null;
};

export type GroupWithTeams = Group & {
  group_teams: (GroupTeam & { team: Team })[];
  matches: Match[];
};

export type TeamWithPlayers = Team & { players: TeamPlayer[] };
export type TournamentWithTeams = Tournament & { teams: TeamWithPlayers[] };

export type ClubWithPlayers = Club & {
  players: ClubPlayer[];
  owner?: Pick<Profile, "display_name" | "picture_url"> | null;
};

import type { ClubPresetConfig } from "@/lib/club/preset";

export type ClubPreset = {
  id: string;
  owner_id: string;
  name: string;
  config: ClubPresetConfig;
  created_at: string;
};

// Payment slip record — created when a player uploads a transfer slip for verification.
export type ClubPaymentSlip = {
  id: string;
  club_id: string;
  club_player_id: string;
  image_path: string;
  amount_detected: number | null;
  sender_name: string | null;
  receiver_name: string | null;
  trans_ref: string | null;
  verify_status: "pending" | "verified" | "failed" | "manual";
  verify_raw: unknown | null;
  created_at: string;
};

// Audit trail for club-level manager actions (billing pushes, payment toggles, etc.).
export type ClubAuditLog = {
  id: string;
  club_id: string;
  actor_id: string | null;
  actor_name: string | null;
  event_type: string;
  detail: string | null;
  created_at: string;
};
