import type { SupabaseClient } from "@supabase/supabase-js";
import { E2E } from "./fixtures";

// T5 race-hardening fixtures — throwaway tournament + 8 pending queue matches
// owned by the suite's seeded profile (global-setup), so the minted bc_session
// cookie can drag/reorder in the browser test. Fixed UUIDs + SMOKE_E2E_ marker;
// seeded/torn down by race-hardening.spec.ts itself (not global-setup).
const suffix = (n: number) => `00000000-0000-4000-8000-0000000e2e${n.toString(16).padStart(2, "0")}`;

export const T5 = {
  tournamentId: suffix(0xa0),
  name: "SMOKE_E2E_T5_tournament",
  matchIds: Array.from({ length: 8 }, (_, i) => suffix(0xa1 + i)),
  teamIds: Array.from({ length: 8 }, (_, i) => suffix(0xb1 + i)),
  teamNames: ["SMOKE_A", "SMOKE_B", "SMOKE_C", "SMOKE_D", "SMOKE_E", "SMOKE_F", "SMOKE_G", "SMOKE_H"],
  courts: ["C1", "C2"],
} as const;

export const T5_QUEUE_URL = `/tournaments/${T5.tournamentId}?tab=queue`;

export async function teardownT5(sb: SupabaseClient): Promise<void> {
  await sb.from("matches").delete().eq("tournament_id", T5.tournamentId);
  await sb.from("teams").delete().eq("tournament_id", T5.tournamentId);
  await sb.from("tournaments").delete().eq("id", T5.tournamentId);
}

export async function seedT5(sb: SupabaseClient): Promise<void> {
  await teardownT5(sb);

  const ins = async (table: string, rows: unknown) => {
    const { error } = await sb.from(table).insert(rows as never);
    if (error) throw new Error(`seed ${table} failed: ${error.message}`);
  };

  await ins("tournaments", {
    id: T5.tournamentId,
    owner_id: E2E.ownerId,
    name: T5.name,
    status: "ongoing",
    courts: T5.courts,
    settings: { realtime_enabled: true, queue_payload_sync: true },
  });
  await ins(
    "teams",
    T5.teamIds.map((id, i) => ({
      id,
      tournament_id: T5.tournamentId,
      name: T5.teamNames[i],
      color: "#1447E6",
      seed: i + 1,
    })),
  );
  await ins(
    "matches",
    T5.matchIds.map((id, i) => ({
      id,
      tournament_id: T5.tournamentId,
      round_type: "group",
      round_number: 1,
      match_number: i + 1,
      status: "pending",
      queue_position: i + 1,
      team_a_id: T5.teamIds[i],
    })),
  );
}

// Restore the deterministic baseline between race rounds:
// all pending, no court, match_number/queue_position = 1..8.
export async function resetT5(sb: SupabaseClient): Promise<void> {
  const results = await Promise.all(
    T5.matchIds.map((id, i) =>
      sb
        .from("matches")
        .update({
          status: "pending",
          court: null,
          started_at: null,
          match_number: i + 1,
          queue_position: i + 1,
        })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`resetT5 failed: ${failed.error.message}`);
}

export async function fetchT5(sb: SupabaseClient) {
  const { data, error } = await sb
    .from("matches")
    .select("id,match_number,status,court")
    .eq("tournament_id", T5.tournamentId);
  if (error) throw new Error(`fetchT5 failed: ${error.message}`);
  return data ?? [];
}
