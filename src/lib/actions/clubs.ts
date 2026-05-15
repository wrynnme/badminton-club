"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  let redirectTo = "/clubs";
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.pathname !== "/") redirectTo = url.pathname + url.search;
    } catch {}
  }
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
}

const ClubSchema = z.object({
  name: z.string().min(2, "ชื่อก๊วนสั้นไป"),
  venue: z.string().min(2, "ระบุสนาม"),
  play_date: z.string().min(1),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  max_players: z.coerce.number().int().min(2).max(40),
  shuttle_info: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type CreateClubInput = z.infer<typeof ClubSchema>;
export type UpdateClubInput = CreateClubInput & { id: string };

export async function createClubAction(input: CreateClubInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = ClubSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("clubs")
    .insert({ ...parsed.data, owner_id: session.profileId })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "สร้างไม่สำเร็จ" };

  revalidatePath("/clubs");
  redirect(`/clubs/${data.id}`);
}

export async function updateClubAction(input: UpdateClubInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const { id, ...rest } = input;
  const parsed = ClubSchema.safeParse(rest);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  const { data: club } = await sb.from("clubs").select("owner_id").eq("id", id).single();
  if (!club || club.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb.from("clubs").update(parsed.data).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${id}`);
  return { ok: true };
}

const JoinSchema = z.object({
  club_id: z.string().uuid(),
  display_name: z.string().min(2, "ชื่อสั้นไป"),
  level: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export type JoinClubInput = z.infer<typeof JoinSchema>;

export async function joinClubAction(input: JoinClubInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = JoinSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();

  const { data: club } = await sb
    .from("clubs")
    .select("max_players")
    .eq("id", parsed.data.club_id)
    .single();
  if (!club) return { error: "ไม่พบก๊วนนี้" };

  const { count } = await sb
    .from("club_players")
    .select("*", { count: "exact", head: true })
    .eq("club_id", parsed.data.club_id);

  if ((count ?? 0) >= club.max_players) {
    return { error: "ก๊วนเต็มแล้ว" };
  }

  const { error } = await sb.from("club_players").insert({
    club_id: parsed.data.club_id,
    profile_id: session.profileId,
    display_name: parsed.data.display_name,
    level: parsed.data.level || null,
    note: parsed.data.note || null,
    position: (count ?? 0) + 1,
  });

  if (error) {
    if (error.code === "23505") return { error: "คุณลงชื่อไว้แล้ว" };
    return { error: error.message };
  }

  revalidatePath(`/clubs/${parsed.data.club_id}`);
  return { ok: true };
}

// ─── Club Expenses ────────────────────────────────────────────────────────────

export type ClubExpense = {
  id: string;
  club_id: string;
  label: string;
  amount: number;
  created_at: string;
};

const ExpenseSchema = z.object({
  club_id: z.string().uuid(),
  label: z.string().min(1, "ระบุชื่อรายการ"),
  amount: z.coerce.number().min(0, "จำนวนเงินไม่ถูกต้อง"),
});

async function assertClubOwner(sb: Awaited<ReturnType<typeof createAdminClient>>, clubId: string, profileId: string) {
  const { data } = await sb.from("clubs").select("owner_id").eq("id", clubId).single();
  if (!data || data.owner_id !== profileId) return false;
  return true;
}

export async function addExpenseAction(input: { club_id: string; label: string; amount: number }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = ExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, parsed.data.club_id, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb.from("club_expenses").insert(parsed.data);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${parsed.data.club_id}`);
  return { ok: true };
}

export async function updateExpenseAction(input: { id: string; club_id: string; label: string; amount: number }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = ExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, parsed.data.club_id, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb
    .from("club_expenses")
    .update({ label: parsed.data.label, amount: parsed.data.amount })
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
  if (!(await assertClubOwner(sb, input.club_id, session.profileId)))
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

export async function reorderPlayersAction(clubId: string, orderedIds: string[]) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const { data: club } = await sb.from("clubs").select("owner_id").eq("id", clubId).single();
  if (!club || club.owner_id !== session.profileId) return { error: "ไม่มีสิทธิ์" };

  await Promise.all(
    orderedIds.map((id, i) =>
      sb.from("club_players").update({ position: i + 1 }).eq("id", id).eq("club_id", clubId)
    )
  );

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

export async function kickPlayerAction(formData: FormData) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const clubId = formData.get("club_id") as string;
  const playerId = formData.get("player_id") as string;

  const sb = await createAdminClient();
  const { data: club } = await sb.from("clubs").select("owner_id").eq("id", clubId).single();
  if (!club || club.owner_id !== session.profileId) return;

  await sb.from("club_players").delete().eq("id", playerId).eq("club_id", clubId);
  revalidatePath(`/clubs/${clubId}`);
}

export async function leaveClubAction(formData: FormData) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const clubId = formData.get("club_id") as string;
  const sb = await createAdminClient();
  await sb
    .from("club_players")
    .delete()
    .eq("club_id", clubId)
    .eq("profile_id", session.profileId);

  revalidatePath(`/clubs/${clubId}`);
}
