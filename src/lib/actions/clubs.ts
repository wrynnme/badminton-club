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
  if (session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE เพื่อสร้างก๊วน" };

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

const GuestSchema = z.object({
  club_id: z.string().uuid(),
  display_name: z.string().min(1, "ระบุชื่อ").max(60, "ชื่อยาวเกินไป"),
  level: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export type AddGuestInput = z.infer<typeof GuestSchema>;

/**
 * Owner / co-admin adds a guest player to the club — a name-only row with
 * profile_id = NULL (no LINE account needed). The UNIQUE(club_id, profile_id)
 * constraint ignores NULLs, so any number of guests can be added.
 */
export async function addGuestPlayerAction(input: AddGuestInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = GuestSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, parsed.data.club_id, session.profileId))) {
    return { error: "ไม่มีสิทธิ์" };
  }

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
    profile_id: null,
    display_name: parsed.data.display_name.trim(),
    level: parsed.data.level || null,
    note: parsed.data.note || null,
    position: (count ?? 0) + 1,
  });

  if (error) return { error: error.message };

  revalidatePath(`/clubs/${parsed.data.club_id}`);
  return { ok: true };
}

// ─── Club cost split config ─────────────────────────────────────────────────────

const CostConfigSchema = z.object({
  court_fee: z.coerce.number().min(0).max(1_000_000),
  court_split: z.enum(["even", "by_time"]),
  shuttle_fee: z.coerce.number().min(0).max(1_000_000),
  shuttle_split: z.enum(["even", "by_games"]),
  court_gap_policy: z.enum(["spread", "owner", "ignore"]),
});

export type CostConfigInput = z.infer<typeof CostConfigSchema>;

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

const PlayerSessionSchema = z.object({
  start_time: z.string().optional().nullable(), // "HH:MM" | "" | null → null = use club window
  end_time: z.string().optional().nullable(),
  games_played: z.coerce.number().int().min(0).max(500),
});

export type PlayerSessionInput = z.infer<typeof PlayerSessionSchema>;

/** Owner / co-admin sets a player's session window + games played (cost-split inputs). */
export async function updateClubPlayerSessionAction(
  clubId: string,
  playerId: string,
  input: PlayerSessionInput,
) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = PlayerSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: "ไม่มีสิทธิ์" };
  }

  const { error } = await sb
    .from("club_players")
    .update({
      start_time: parsed.data.start_time?.trim() || null,
      end_time: parsed.data.end_time?.trim() || null,
      games_played: parsed.data.games_played,
    })
    .eq("id", playerId)
    .eq("club_id", clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

// ─── Club Expenses ────────────────────────────────────────────────────────────

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

async function assertClubOwner(sb: Awaited<ReturnType<typeof createAdminClient>>, clubId: string, profileId: string) {
  const { data, error } = await sb.from("clubs").select("owner_id").eq("id", clubId).maybeSingle();
  if (error) throw new Error("permission_check_failed");
  if (!data || data.owner_id !== profileId) return false;
  return true;
}

async function assertCanManageClub(sb: Awaited<ReturnType<typeof createAdminClient>>, clubId: string, profileId: string) {
  const { data, error } = await sb
    .from("clubs")
    .select("owner_id, club_admins!left(user_id)")
    .eq("id", clubId)
    .eq("club_admins.user_id", profileId)
    .maybeSingle();
  if (error) throw new Error("permission_check_failed");
  if (!data) return false;
  const admins = (data.club_admins ?? []) as { user_id: string }[];
  return data.owner_id === profileId || admins.length > 0;
}

export async function addExpenseAction(input: { club_id: string; label: string; amount: number; payer_player_ids?: string[] }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = ExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, parsed.data.club_id, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const payers = await validClubPayerIds(sb, parsed.data.club_id, parsed.data.payer_player_ids);
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
  if (!(await assertClubOwner(sb, parsed.data.club_id, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const payers = await validClubPayerIds(sb, parsed.data.club_id, parsed.data.payer_player_ids);
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
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

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
  if (!(await assertCanManageClub(sb, clubId, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  await sb.from("club_players").delete().eq("id", playerId).eq("club_id", clubId);
  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

export async function toggleCheckInAction(input: { club_id: string; player_id: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  if (!(await assertCanManageClub(sb, input.club_id, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const { data: player } = await sb
    .from("club_players")
    .select("checked_in_at")
    .eq("id", input.player_id)
    .eq("club_id", input.club_id)
    .single();

  if (!player) return { error: "ไม่พบผู้เล่น" };

  const next = player.checked_in_at ? null : new Date().toISOString();
  const { error } = await sb
    .from("club_players")
    .update({ checked_in_at: next })
    .eq("id", input.player_id);

  if (error) return { error: error.message };
  revalidatePath(`/clubs/${input.club_id}`);
  return { ok: true };
}

// ─── Co-Admin ─────────────────────────────────────────────────────────────────

export type ClubAdmin = {
  club_id: string;
  user_id: string;
  display_name: string | null;
  line_user_id: string | null;
  added_by: string | null;
  added_at: string;
};

export type ClubProfileSearchResult = {
  id: string;
  display_name: string | null;
  line_user_id: string | null;
};

const LINE_USER_ID_RE = /^U[0-9a-f]{32}$/i;

export async function addClubCoAdminAction(
  clubId: string,
  lineUserId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const trimmed = lineUserId.trim();
  if (!LINE_USER_ID_RE.test(trimmed))
    return { error: "LINE user ID ไม่ถูกต้อง" };

  const { data: profile } = await sb
    .from("profiles")
    .select("id")
    .eq("line_user_id", trimmed)
    .maybeSingle();

  if (!profile) return { error: "ไม่พบผู้ใช้ที่ login ด้วย LINE นี้" };
  if (profile.id === session.profileId) return { error: "ไม่สามารถเพิ่มตัวเองเป็น co-admin" };

  const { error } = await sb.from("club_admins").insert({
    club_id: clubId,
    user_id: profile.id,
    added_by: session.profileId,
  });

  if (error) {
    if (error.code === "23505") return { error: "ผู้ใช้นี้เป็น co-admin อยู่แล้ว" };
    return { error: "เพิ่มผู้ช่วยดูแลไม่สำเร็จ" };
  }

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

export async function removeClubCoAdminAction(
  clubId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const { error: deleteError } = await sb
    .from("club_admins")
    .delete()
    .eq("club_id", clubId)
    .eq("user_id", userId);
  if (deleteError) return { error: "ลบผู้ช่วยดูแลไม่สำเร็จ" };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

export async function searchClubProfilesAction(
  clubId: string,
  query: string
): Promise<{ ok: true; results: ClubProfileSearchResult[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const q = query.trim();
  if (q.length < 2) return { ok: true, results: [] };

  const { data: existing } = await sb
    .from("club_admins")
    .select("user_id")
    .eq("club_id", clubId);

  const excludeIds = [session.profileId, ...(existing ?? []).map((r) => r.user_id)];
  const escapedQ = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  // excludeIds always has session.profileId — never empty
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name, line_user_id")
    .ilike("display_name", `%${escapedQ}%`)
    .not("line_user_id", "is", null)
    .not("id", "in", `(${excludeIds.join(",")})`)
    .limit(20);

  if (error) return { error: "ค้นหาไม่สำเร็จ" };
  return { ok: true, results: (data ?? []) as ClubProfileSearchResult[] };
}

// ─── Leave ────────────────────────────────────────────────────────────────────

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
