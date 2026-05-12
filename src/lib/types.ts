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
};

export type ClubPlayer = {
  id: string;
  club_id: string;
  profile_id: string | null;
  display_name: string;
  level: string | null;
  note: string | null;
  joined_at: string;
  position: number | null;
};

export type TournamentMode = "sports_day" | "competition";
export type TournamentStatus = "draft" | "registering" | "ongoing" | "completed";
export type TournamentFormat = "group_only" | "group_knockout" | "knockout_only";
export type SeedingMethod = "random" | "by_group_score";
export type TeamRole = "captain" | "member";
export type MatchUnit = "team" | "pair";

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
  created_at: string;
};

export type MatchRoundType = "group" | "knockout" | "upper_qf" | "upper_sf" | "upper_final" | "lower_qf" | "lower_sf" | "lower_final" | "grand_final";
export type MatchStatus = "pending" | "in_progress" | "completed";

export type Group = {
  id: string;
  tournament_id: string;
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
  division: "upper" | "lower" | null;
  created_at: string;
};

export type Pair = {
  id: string;
  team_id: string;
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
