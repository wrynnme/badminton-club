import { createAdminClient } from "@/lib/supabase/server";

export async function notifyTournamentOwner(tournamentId: string, text: string): Promise<void> {
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

    const { data: profile } = await sb
      .from("profiles")
      .select("line_user_id")
      .eq("id", tournament.owner_id)
      .single();
    if (!profile?.line_user_id) return;

    const message = `[${tournament.name}]\n${text}`;

    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: profile.line_user_id,
        messages: [{ type: "text", text: message }],
      }),
    });
  } catch {
    // notification must never throw
  }
}
