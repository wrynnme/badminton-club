import { createAdminClient } from "@/lib/supabase/server";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  type TournamentSettings,
} from "@/lib/tournament/settings";

// Fetches the raw settings jsonb for a tournament and returns a fully-defaulted TournamentSettings.
// Server-only — keeps `next/headers` (pulled in by createAdminClient) out of client bundles.
export async function getTournamentSettings(tournamentId: string): Promise<TournamentSettings> {
  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("tournaments")
    .select("settings")
    .eq("id", tournamentId)
    .maybeSingle();
  if (error || !data) return DEFAULT_SETTINGS;
  return parseSettings(data.settings);
}
