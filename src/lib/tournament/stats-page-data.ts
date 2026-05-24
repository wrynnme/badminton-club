import { createAdminClient } from "@/lib/supabase/server";
import {
  buildCompetitorMap,
  type Competitor,
} from "@/lib/tournament/competitor";
import {
  parseSettings,
  type TournamentSettings,
} from "@/lib/tournament/settings";
import type {
  Tournament,
  Team,
  PairWithPlayers,
  Match,
} from "@/lib/types";

export type StatsPageData = {
  tournament: Tournament;
  teams: Team[];
  pairs: PairWithPlayers[];
  matches: Match[];
  settings: TournamentSettings;
  competitorById: Map<string, Competitor>;
  backHref: string;
};

async function loadCommon(
  tournament: Tournament,
  backHref: string
): Promise<StatsPageData> {
  const sb = await createAdminClient();
  const [matchesRes, teamsRes] = await Promise.all([
    sb
      .from("matches")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("match_number"),
    sb
      .from("teams")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("created_at"),
  ]);

  const teams: Team[] = (teamsRes.data ?? []) as Team[];
  const matches: Match[] = (matchesRes.data ?? []) as Match[];

  const teamIdList = teams.map((x) => x.id);
  const pairsRes = teamIdList.length
    ? await sb
        .from("pairs")
        .select(
          "*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)"
        )
        .in("team_id", teamIdList)
        .order("created_at")
    : { data: [] };

  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];

  const competitorById = buildCompetitorMap("pair", teams, pairs);
  const settings = parseSettings(tournament.settings);

  return {
    tournament,
    teams,
    pairs,
    matches,
    settings,
    competitorById,
    backHref,
  };
}

/**
 * Load stats page data for the admin route (/tournaments/[id]/stats/...).
 *
 * Does NOT gate on authentication — stats pages are read-only and viewable
 * by any signed-in user. Pages that want a redirect-to-login behavior should
 * call `getSession()` themselves before invoking this loader.
 *
 * Returns `null` when the tournament does not exist (callers should call
 * `notFound()`).
 */
export async function loadStatsTournamentByAdmin(
  tournamentId: string
): Promise<StatsPageData | null> {
  const sb = await createAdminClient();
  const { data: tournament } = await sb
    .from("tournaments")
    .select("*")
    .eq("id", tournamentId)
    .maybeSingle();

  if (!tournament) return null;
  const t = tournament as Tournament;
  return loadCommon(t, `/tournaments/${t.id}?tab=pair`);
}

/**
 * Load stats page data for the public share route (/t/[token]/stats/...).
 * Resolves the tournament by `share_token`. No auth required.
 *
 * Returns `null` when no tournament matches the token (callers should call
 * `notFound()`).
 */
export async function loadStatsTournamentByToken(
  token: string
): Promise<StatsPageData | null> {
  const sb = await createAdminClient();
  const { data: tournament } = await sb
    .from("tournaments")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();

  if (!tournament) return null;
  const t = tournament as Tournament;
  return loadCommon(t, `/t/${token}`);
}
