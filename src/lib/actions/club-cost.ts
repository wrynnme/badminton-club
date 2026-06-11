"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";

const CostConfigSchema = z.object({
  court_fee: z.coerce.number().min(0).max(1_000_000),
  court_split: z.enum(["even", "by_time"]),
  shuttle_split: z.enum(["even", "per_match", "per_player"]),
  shuttle_price: z.coerce.number().min(0).max(100_000),
  court_gap_policy: z.enum(["spread", "owner", "ignore"]),
});

export type CostConfigInput = z.infer<typeof CostConfigSchema>;

export type ClubExpense = {
  id: string;
  club_id: string;
  label: string;
  amount: number;
  /** Designated payers (club_players.id). Empty = charged to ALL players. */
  payer_player_ids: string[];
  created_at: string;
};

const ExpenseSchema = z.object({
  club_id: z.string().uuid(),
  label: z.string().min(1, "ระบุชื่อรายการ"),
  amount: z.coerce.number().min(0, "จำนวนเงินไม่ถูกต้อง"),
  payer_player_ids: z.array(z.string().uuid()).default([]),
});

/** Keep only the payer ids that are real players of this club. */
async function validClubPayerIds(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  clubId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await sb.from("club_players").select("id").eq("club_id", clubId).in("id", ids);
  const valid = new Set((data ?? []).map((r) => r.id));
  return ids.filter((id) => valid.has(id));
}

/** Owner / co-admin sets the club's court + shuttle fee and per-bucket split mode. */
export async function updateClubCostConfigAction(clubId: string, input: CostConfigInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = CostConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: "ไม่มีสิทธิ์" };
  }

  const { error } = await sb.from("clubs").update(parsed.data).eq("id", clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

export async function addExpenseAction(input: { club_id: string; label: string; amount: number; payer_player_ids?: string[] }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = ExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, parsed.data.club_id, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const payers = await validClubPayerIds(sb, parsed.data.club_id, parsed.data.payer_player_ids);
  // Guard: if the user designated specific payers but none survive validation
  // (all removed from the club), do NOT fall through to [] = "charge everyone".
  if (parsed.data.payer_player_ids.length > 0 && payers.length === 0) {
    return { error: "ผู้จ่ายที่เลือกไม่อยู่ในก๊วนนี้แล้ว — เลือกใหม่" };
  }
  const { error } = await sb.from("club_expenses").insert({
    club_id: parsed.data.club_id,
    label: parsed.data.label,
    amount: parsed.data.amount,
    payer_player_ids: payers,
  });
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${parsed.data.club_id}`);
  return { ok: true };
}

export async function updateExpenseAction(input: { id: string; club_id: string; label: string; amount: number; payer_player_ids?: string[] }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = ExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, parsed.data.club_id, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const payers = await validClubPayerIds(sb, parsed.data.club_id, parsed.data.payer_player_ids);
  if (parsed.data.payer_player_ids.length > 0 && payers.length === 0) {
    return { error: "ผู้จ่ายที่เลือกไม่อยู่ในก๊วนนี้แล้ว — เลือกใหม่" };
  }
  const { error } = await sb
    .from("club_expenses")
    .update({ label: parsed.data.label, amount: parsed.data.amount, payer_player_ids: payers })
    .eq("id", input.id)
    .eq("club_id", parsed.data.club_id);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${parsed.data.club_id}`);
  return { ok: true };
}

export async function deleteExpenseAction(input: { id: string; club_id: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.club_id, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb
    .from("club_expenses")
    .delete()
    .eq("id", input.id)
    .eq("club_id", input.club_id);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${input.club_id}`);
  return { ok: true };
}

// ─── Legacy ───────────────────────────────────────────────────────────────────

export async function setTotalCostAction(input: { club_id: string; total_cost: number }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (isNaN(input.total_cost) || input.total_cost < 0)
    return { error: "ค่าก๊วนไม่ถูกต้อง" };

  const sb = await createAdminClient();
  const { data: club } = await sb
    .from("clubs")
    .select("owner_id")
    .eq("id", input.club_id)
    .single();

  if (!club || club.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb
    .from("clubs")
    .update({ total_cost: input.total_cost })
    .eq("id", input.club_id);

  if (error) return { error: error.message };
  revalidatePath(`/clubs/${input.club_id}`);
  return { ok: true };
}
