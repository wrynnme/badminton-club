import { createAdminClient } from "@/lib/supabase/server";
import { getTournamentSettings } from "@/lib/tournament/settings.server";

export async function writeAuditLog(params: {
  tournament_id: string;
  actor_id: string;
  actor_name: string;
  event_type: string;
  entity_type?: string;
  entity_id?: string;
  description: string;
}) {
  // Audit is best-effort: a failure here must never bubble up and crash the caller.
  try {
    const settings = await getTournamentSettings(params.tournament_id);
    if (!settings.audit_log_enabled) return;
    const sb = await createAdminClient();
    const { error } = await sb.from("audit_logs").insert(params);
    if (error) console.error("[audit] write failed:", error.message);
  } catch (err) {
    console.error("[audit] exception:", err);
  }
}
