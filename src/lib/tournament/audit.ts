import { createAdminClient } from "@/lib/supabase/server";

export async function writeAuditLog(params: {
  tournament_id: string;
  actor_id: string;
  actor_name: string;
  event_type: string;
  entity_type?: string;
  entity_id?: string;
  description: string;
}) {
  const sb = await createAdminClient();
  const { error } = await sb.from("audit_logs").insert(params);
  if (error) console.error("[audit] write failed:", error.message);
}
