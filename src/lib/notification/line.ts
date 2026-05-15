import { createAdminClient } from "@/lib/supabase/server";

export async function notifyTournamentAdmins(tournamentId: string, text: string): Promise<void> {
  try {
    const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
    if (!token) return;

    const sb = await createAdminClient();

    const { data: tournament } = await sb
      .from("tournaments")
      .select("name, owner_id")
      .eq("id", tournamentId)
      .single();
    if (!tournament) return;

    const { data: coAdmins } = await sb
      .from("tournament_admins")
      .select("user_id")
      .eq("tournament_id", tournamentId);

    const userIds = [tournament.owner_id, ...(coAdmins ?? []).map((a) => a.user_id)];

    const { data: profiles } = await sb
      .from("profiles")
      .select("line_user_id")
      .in("id", userIds);

    const lineUserIds = (profiles ?? [])
      .map((p) => p.line_user_id)
      .filter((id): id is string => !!id);

    if (lineUserIds.length === 0) return;

    const message = `[${tournament.name}]\n${text}`;

    // LINE multicast: up to 500 IDs per request
    if (lineUserIds.length === 1) {
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: lineUserIds[0],
          messages: [{ type: "text", text: message }],
        }),
      });
    } else {
      await fetch("https://api.line.me/v2/bot/message/multicast", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: lineUserIds,
          messages: [{ type: "text", text: message }],
        }),
      });
    }
  } catch {
    // notification must never throw
  }
}
