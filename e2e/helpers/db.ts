import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { E2E } from "./fixtures";

// Service-role client (bypasses RLS) for seed + teardown + assertions. Uses the
// same env vars the app uses. NOTE: this runs against the project's single
// (production) Supabase — every row is throwaway + marker-tagged + torn down.
export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase env missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Delete every throwaway row for this suite, child→parent (FK order). Idempotent.
export async function teardownE2E(sb: SupabaseClient): Promise<void> {
  await sb.from("club_matches").delete().eq("club_id", E2E.clubId);
  await sb.from("club_players").delete().eq("club_id", E2E.clubId);
  await sb.from("clubs").delete().eq("id", E2E.clubId);
  await sb.from("profiles").delete().eq("id", E2E.ownerId);
}

// Fresh throwaway club: owner profile + 2-court singles club (game_time_limit 1 min
// for the A4 over-time check) + 4 active players. Cleans any stale leftover first.
export async function seedE2E(sb: SupabaseClient): Promise<void> {
  await teardownE2E(sb);

  const ins = async (table: string, rows: unknown) => {
    const { error } = await sb.from(table).insert(rows as never);
    if (error) throw new Error(`seed ${table} failed: ${error.message}`);
  };

  await ins("profiles", { id: E2E.ownerId, display_name: E2E.ownerName });
  await ins("clubs", {
    id: E2E.clubId,
    owner_id: E2E.ownerId,
    name: E2E.clubName,
    venue: "SMOKE",
    play_date: "2026-01-01",
    start_time: "18:00",
    end_time: "21:00",
    queue_settings: {
      players_per_team: 1,
      court_count: 2,
      game_time_limit_min: E2E.gameTimeLimitMin,
      rotation_mode: "fair_queue",
    },
    courts: E2E.courts,
  });
  await ins(
    "club_players",
    E2E.players.map((display_name) => ({ club_id: E2E.clubId, display_name, status: "active" })),
  );
}
