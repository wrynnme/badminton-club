import { createAdminClient } from "@/lib/supabase/server";

export async function assertIsOwner(tournamentId: string, userId: string): Promise<boolean> {
  const sb = await createAdminClient();
  const { data, error } = await sb.from("tournaments").select("owner_id").eq("id", tournamentId).single();
  if (error) throw new Error("permission_check_failed");
  return data?.owner_id === userId;
}

export async function assertCanEdit(tournamentId: string, userId: string): Promise<boolean> {
  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("tournaments")
    .select("owner_id, tournament_admins!left(user_id)")
    .eq("id", tournamentId)
    .eq("tournament_admins.user_id", userId)
    .maybeSingle();
  if (error) throw new Error("permission_check_failed");
  if (!data) return false;
  const admins = (data.tournament_admins ?? []) as { user_id: string }[];
  return data.owner_id === userId || admins.length > 0;
}
