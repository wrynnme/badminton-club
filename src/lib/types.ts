export type Profile = {
  id: string;
  line_user_id: string | null;
  display_name: string;
  picture_url: string | null;
  is_guest: boolean;
  created_at: string;
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
  shuttle_fee: number;
  shuttle_split: ShuttleSplit;
  shuttle_price: number; // price per shuttle, used when shuttle_split = "per_match"
  court_gap_policy: GapPolicy;
  // Rotation-queue config (raw jsonb; parse via parseQueueSettings in queue-settings.ts)
  queue_settings: Record<string, unknown>;
};

export type CourtSplit = "even" | "by_time";
export type ShuttleSplit = "even" | "per_match" | "per_player";
export type GapPolicy = "spread" | "owner" | "ignore";

export type ClubPlayer = {
  id: string;
  club_id: string;
  profile_id: string | null;
  display_name: string;
  level: string | null;
  note: string | null;
  joined_at: string;
  position: number | null;
  checked_in_at: string | null;
  // Cost split inputs — per-player session window + games played
  start_time: string | null; // "HH:MM:SS" or null = use club window
  end_time: string | null;
  games_played: number; // manual pre-queue fallback; auto-incremented from completed club_matches once rotation queue is used
  last_finished_at: string | null; // ISO; rest-ordering input for queue_mode='rest_longest'
};

// Locked pair: two players forced to be teammates by the rotation queue.
// games_remaining null = forever; N = lock for N more games played together.
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
export type ClubMatch = {
  id: string;
  club_id: string;
  court: number;
  side_a_player1: string;
  side_a_player2: string | null;
  side_b_player1: string;
  side_b_player2: string | null;
  status: ClubMatchStatus;
  shuttles_used: number; // shuttles consumed by this match (for shuttle_split="per_match")
  queue_position: number | null;
  winner_side: "a" | "b" | null;
  score_a: number | null;
  score_b: number | null;
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
  settings: Record<string, unknown>;
  notes: string | null;
  created_at: string;
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
  level: string | null;
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
