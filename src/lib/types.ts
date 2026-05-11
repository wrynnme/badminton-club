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
  cost_per_person: number | null;
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
};

export type ClubWithPlayers = Club & {
  players: ClubPlayer[];
  owner?: Pick<Profile, "display_name" | "picture_url"> | null;
};
