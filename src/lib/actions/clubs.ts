"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import type { Level } from "@/lib/types";
import {
  type ClubQueueSettings,
  ClubQueueSettingsSchema,
  parseQueueSettings,
} from "@/lib/club/queue-settings";
import {
  buildNextMatch,
  deriveWinnerSide,
  type QueuePlayer,
  type MatchSide,
} from "@/lib/club/queue";
import type { ClubMatch } from "@/lib/types";

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
  level_id: z.string().uuid().optional().nullable(),
  note: z.string().optional().nullable(),
});

export type JoinClubInput = z.infer<typeof JoinSchema>;

/**
 * Head-counts for a club: `total` (for the next sequential position) and
 * `active` (for the max_players cap — reserves don't count against it).
 */
async function countClubPlayers(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  clubId: string,
): Promise<{ total: number; active: number }> {
  const [{ count: total }, { count: active }] = await Promise.all([
    sb
      .from("club_players")
      .select("*", { count: "exact", head: true })
      .eq("club_id", clubId),
    sb
      .from("club_players")
      .select("*", { count: "exact", head: true })
      .eq("club_id", clubId)
      .eq("status", "active"),
  ]);
  return { total: total ?? 0, active: active ?? 0 };
}

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

  const { total, active } = await countClubPlayers(sb, parsed.data.club_id);
  // Full → join as reserve; auto-promoted when an active player leaves.
  const status = active >= club.max_players ? "reserve" : "active";

  const { error } = await sb.from("club_players").insert({
    club_id: parsed.data.club_id,
    profile_id: session.profileId,
    display_name: parsed.data.display_name,
    level_id: parsed.data.level_id || null,
    note: parsed.data.note || null,
    position: total + 1,
    status,
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
  level_id: z.string().uuid().optional().nullable(),
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

  const { total, active } = await countClubPlayers(sb, parsed.data.club_id);
  // Full → add as reserve; auto-promoted when an active player leaves.
  const status = active >= club.max_players ? "reserve" : "active";

  const { error } = await sb.from("club_players").insert({
    club_id: parsed.data.club_id,
    profile_id: null,
    display_name: parsed.data.display_name.trim(),
    level_id: parsed.data.level_id || null,
    note: parsed.data.note || null,
    position: total + 1,
    status,
  });

  if (error) return { error: error.message };

  revalidatePath(`/clubs/${parsed.data.club_id}`);
  return { ok: true };
}

// ─── Club cost split config ─────────────────────────────────────────────────────

const CostConfigSchema = z.object({
  court_fee: z.coerce.number().min(0).max(1_000_000),
  court_split: z.enum(["even", "by_time"]),
  shuttle_split: z.enum(["even", "per_match", "per_player"]),
  shuttle_price: z.coerce.number().min(0).max(100_000),
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

/**
 * Fetch a club_match by id + verify the caller can manage its club. Shared by the
 * match-lifecycle actions (start / finish / cancel / shuttles / delete) to replace
 * the repeated fetch → not-found → assertCanManageClub block.
 */
async function loadClubMatchForManage(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  matchId: string,
  profileId: string,
): Promise<{ match: { id: string; club_id: string } } | { error: string }> {
  const { data: match, error } = await sb
    .from("club_matches")
    .select("id, club_id")
    .eq("id", matchId)
    .single();
  if (error || !match) return { error: "ไม่พบแมตช์" };
  if (!(await assertCanManageClub(sb, match.club_id, profileId))) {
    return { error: "ไม่มีสิทธิ์" };
  }
  return { match };
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

export async function reorderPlayersAction(clubId: string, orderedIds: string[]) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      sb.from("club_players").update({ position: i + 1 }).eq("id", id).eq("club_id", clubId)
    )
  );
  // Don't silently swallow a partial failure — mirror reorderClubQueueAction.
  for (const { error } of results) {
    if (error) return { error: "จัดลำดับไม่สำเร็จ" };
  }

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

  // Delete + auto-promote the earliest reserve into the freed slot (atomic RPC).
  await sb.rpc("remove_club_player_and_promote", {
    p_player_id: playerId,
    p_club_id: clubId,
  });
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

  // Resolve the caller's player row, then delete + auto-promote a reserve (atomic).
  const { data: row } = await sb
    .from("club_players")
    .select("id")
    .eq("club_id", clubId)
    .eq("profile_id", session.profileId)
    .maybeSingle();
  if (row) {
    await sb.rpc("remove_club_player_and_promote", {
      p_player_id: row.id,
      p_club_id: clubId,
    });
  }

  revalidatePath(`/clubs/${clubId}`);
}

// ─── Rotation-Queue Actions ───────────────────────────────────────────────────

/**
 * Owner / co-admin updates the club's rotation-queue settings.
 * Shallow-merges `patch` over the current settings, then re-validates the
 * merged object so bad patches are rejected before writing.
 */
export async function updateClubQueueSettingsAction(
  clubId: string,
  patch: Partial<ClubQueueSettings>,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const { data: club, error: fetchError } = await sb
    .from("clubs")
    .select("queue_settings")
    .eq("id", clubId)
    .single();
  if (fetchError || !club) return { error: "ไม่พบก๊วนนี้" };

  const current = parseQueueSettings(club.queue_settings);
  const merged = { ...current, ...patch };

  let validated: ClubQueueSettings;
  try {
    validated = ClubQueueSettingsSchema.parse(merged);
  } catch {
    return { error: "การตั้งค่าคิวไม่ถูกต้อง" };
  }

  const { error: writeError } = await sb
    .from("clubs")
    .update({ queue_settings: validated })
    .eq("id", clubId);
  if (writeError) return { error: writeError.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

/**
 * Owner / co-admin sets the club's named courts (mirror tournament
 * updateCourtsAction). Trim + dedupe + cap; replaces queue_settings.court_count.
 */
export async function updateClubCourtsAction(
  clubId: string,
  courts: string[],
): Promise<{ ok: true; courts: string[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const COURT_NAME_MAX = 40;
  const COURTS_MAX = 50;
  const cleaned = courts
    .map((c) => c.trim().slice(0, COURT_NAME_MAX))
    .filter((c) => c.length > 0);
  const deduped = Array.from(new Set(cleaned)).slice(0, COURTS_MAX);

  const { error } = await sb.from("clubs").update({ courts: deduped }).eq("id", clubId);
  if (error) {
    console.error("[updateClubCourtsAction]", error);
    return { error: "บันทึกสนามไม่สำเร็จ" };
  }

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true, courts: deduped };
}

/**
 * Owner / co-admin proposes the next match for a given court.
 *
 * Pool eligibility:
 *  1. Exclude players currently assigned to a pending or in_progress match.
 *  2. Check-in gate: if ANY player in the club is checked in, restrict the pool
 *     to checked-in players only. Clubs that don't use check-in (nobody checked
 *     in) continue using all players — this preserves backwards compatibility.
 *
 * winner_stays: the most recently completed match on this court is inspected.
 * The winning side's streak is computed (consecutive wins by the same set of
 * player ids). If the cap hasn't been reached and the winners are still
 * pool-eligible, they stay on court as sideA and are removed from the pool
 * before the opponents are drawn.
 */
export async function buildNextClubMatchAction(
  clubId: string,
  court: string,
): Promise<{ ok: true; match: ClubMatch } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const courtName = court.trim();
  if (!courtName) return { error: "ระบุสนาม" };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  // Load settings.
  const { data: clubRow, error: clubFetchError } = await sb
    .from("clubs")
    .select("queue_settings")
    .eq("id", clubId)
    .single();
  if (clubFetchError || !clubRow) return { error: "ไม่พบก๊วนนี้" };
  const settings = parseQueueSettings(clubRow.queue_settings);

  // Load active players for this club (level resolved via the levels FK).
  // Reserves (status='reserve') are excluded — they wait until promoted and are
  // never drafted into a match by the queue builder.
  const { data: allPlayers, error: playersFetchError } = await sb
    .from("club_players")
    .select("id, position, joined_at, level_id, games_played, last_finished_at, checked_in_at, levels:level_id(real)")
    .eq("club_id", clubId)
    .eq("status", "active");
  if (playersFetchError || !allPlayers) return { error: "โหลดผู้เล่นไม่สำเร็จ" };

  // Collect ids of players already in an active (pending or in_progress) match.
  const { data: activeMatches } = await sb
    .from("club_matches")
    .select("side_a_player1, side_a_player2, side_b_player1, side_b_player2")
    .eq("club_id", clubId)
    .in("status", ["pending", "in_progress"]);

  const activePlayers = new Set<string>();
  for (const m of activeMatches ?? []) {
    if (m.side_a_player1) activePlayers.add(m.side_a_player1);
    if (m.side_a_player2) activePlayers.add(m.side_a_player2);
    if (m.side_b_player1) activePlayers.add(m.side_b_player1);
    if (m.side_b_player2) activePlayers.add(m.side_b_player2);
  }

  // Check-in gate: if at least one player is checked in, only checked-in players
  // are pool-eligible. Clubs that don't use check-in (nobody is checked in) use
  // all players so existing behavior is preserved.
  const anyCheckedIn = allPlayers.some((p) => p.checked_in_at != null);

  // Build pool-eligible set: not in active match + (check-in gate if applicable).
  const eligiblePlayers = allPlayers.filter((p) => {
    if (activePlayers.has(p.id)) return false;
    if (anyCheckedIn && p.checked_in_at == null) return false;
    return true;
  });

  // Map to QueuePlayer. Level = levels.real (via FK embed); NaN → null.
  const toQueuePlayer = (p: (typeof eligiblePlayers)[number]): QueuePlayer => {
    const lvRow = Array.isArray(p.levels) ? p.levels[0] : p.levels;
    let level: number | null = null;
    if (lvRow?.real != null) {
      const r = Number(lvRow.real);
      level = Number.isNaN(r) ? null : r;
    }
    return {
      id: p.id,
      position: p.position,
      joined_at: p.joined_at,
      level,
      games_played: p.games_played,
      last_finished_at: p.last_finished_at,
    };
  };

  let pool: QueuePlayer[] = eligiblePlayers.map(toQueuePlayer);
  let stayingSide: MatchSide | undefined;

  // winner_stays: determine if the most recent winners keep playing.
  if (settings.rotation_mode === "winner_stays") {
    const { data: recentMatches } = await sb
      .from("club_matches")
      .select(
        "side_a_player1, side_a_player2, side_b_player1, side_b_player2, winner_side, ended_at",
      )
      .eq("club_id", clubId)
      .eq("court", courtName)
      .eq("status", "completed")
      .not("winner_side", "is", null)
      .order("ended_at", { ascending: false })
      .limit(20);

    if (recentMatches && recentMatches.length > 0) {
      const lastWin = recentMatches[0];

      // Extract winning player ids from the latest match.
      const winningIds =
        lastWin.winner_side === "a"
          ? [lastWin.side_a_player1, lastWin.side_a_player2]
          : [lastWin.side_b_player1, lastWin.side_b_player2];
      const winnerSet = new Set(winningIds.filter((id): id is string => id != null));
      const sortedWinnerIds = [...winnerSet].sort();

      // Compute streak: count how many consecutive completed matches (newest→older)
      // were won by exactly the same set of player ids.
      let streak = 0;
      for (const match of recentMatches) {
        const mWinIds =
          match.winner_side === "a"
            ? [match.side_a_player1, match.side_a_player2]
            : [match.side_b_player1, match.side_b_player2];
        const mWinSet = [...new Set(mWinIds.filter((id): id is string => id != null))].sort();
        if (
          mWinSet.length === sortedWinnerIds.length &&
          mWinSet.every((id, i) => id === sortedWinnerIds[i])
        ) {
          streak++;
        } else {
          break;
        }
      }

      // Check cap: 0 = unlimited, otherwise streak must be below the cap.
      const capOk = settings.winner_stays_max === 0 || streak < settings.winner_stays_max;

      // All winners must still be pool-eligible (not in another active match, and
      // pass the check-in gate if applicable).
      const eligibleIds = new Set(eligiblePlayers.map((p) => p.id));
      const winnersEligible = [...winnerSet].every((id) => eligibleIds.has(id));

      if (capOk && winnersEligible) {
        // Winners stay: remove them from the pool before picking opponents.
        const winnerIds1 =
          lastWin.winner_side === "a" ? lastWin.side_a_player1 : lastWin.side_b_player1;
        const winnerIds2 =
          lastWin.winner_side === "a" ? lastWin.side_a_player2 : lastWin.side_b_player2;
        stayingSide = { player1: winnerIds1, player2: winnerIds2 ?? null };
        pool = pool.filter((p) => !winnerSet.has(p.id));
      }
    }
  }

  // Load active locked pairs (teammate locks honored by the queue, doubles only).
  const { data: lockRows } = await sb
    .from("club_locked_pairs")
    .select("player1_id, player2_id")
    .eq("club_id", clubId);
  const lockedPairs: [string, string][] = (lockRows ?? []).map((r) => [
    r.player1_id,
    r.player2_id,
  ]);

  // Build the proposed match.
  const proposed = buildNextMatch(pool, settings, stayingSide, lockedPairs);
  if (!proposed) return { error: "ผู้เล่นว่างไม่พอสำหรับสร้างแมตช์" };

  // Compute next queue_position for this club's pending matches.
  const { data: maxRow } = await sb
    .from("club_matches")
    .select("queue_position")
    .eq("club_id", clubId)
    .eq("status", "pending")
    .order("queue_position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextQueuePosition = (maxRow?.queue_position ?? 0) + 1;

  // Insert the match row.
  const { data: newMatch, error: insertError } = await sb
    .from("club_matches")
    .insert({
      club_id: clubId,
      court: courtName,
      side_a_player1: proposed.sideA.player1,
      side_a_player2: proposed.sideA.player2 ?? null,
      side_b_player1: proposed.sideB.player1,
      side_b_player2: proposed.sideB.player2 ?? null,
      status: "pending",
      queue_position: nextQueuePosition,
    })
    .select()
    .single();

  if (insertError || !newMatch) return { error: insertError?.message ?? "สร้างแมตช์ไม่สำเร็จ" };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true, match: newMatch as ClubMatch };
}

/**
 * Owner / co-admin starts a pending match (pending → in_progress).
 * A partial UNIQUE index on (club_id, court) WHERE status='in_progress' ensures
 * only one in_progress match per court; Postgres raises 23505 if violated.
 */
export async function startClubMatchAction(
  matchId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const guard = await loadClubMatchForManage(sb, matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;

  const { error: updateError } = await sb
    .from("club_matches")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", matchId)
    .eq("status", "pending");

  if (updateError) {
    if (updateError.code === "23505") return { error: "สนามนี้มีแมตช์กำลังเล่นอยู่" };
    return { error: updateError.message };
  }

  revalidatePath(`/clubs/${match.club_id}`);
  return { ok: true };
}

/**
 * Owner / co-admin records the result and finishes a match.
 * games_played + last_finished_at are incremented atomically inside the RPC —
 * do NOT also update them here.
 */
export async function finishClubMatchAction(input: {
  matchId: string;
  winnerSide?: "a" | "b";
  scoreA?: number;
  scoreB?: number;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const guard = await loadClubMatchForManage(sb, input.matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;

  // Full-score finish derives the winner from the score (server-authoritative);
  // an explicit winnerSide (winner-only finish) is honored as-is.
  const winnerSide =
    input.winnerSide ??
    (input.scoreA != null && input.scoreB != null
      ? deriveWinnerSide(input.scoreA, input.scoreB) ?? undefined
      : undefined);

  const { error: rpcError } = await sb.rpc("finish_club_match", {
    p_match_id: input.matchId,
    p_winner_side: winnerSide ?? null,
    p_score_a: input.scoreA ?? null,
    p_score_b: input.scoreB ?? null,
  });
  if (rpcError) return { error: rpcError.message };

  revalidatePath(`/clubs/${match.club_id}`);
  return { ok: true };
}

/**
 * Owner / co-admin cancels a pending or in_progress match.
 */
export async function cancelClubMatchAction(
  matchId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const guard = await loadClubMatchForManage(sb, matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;

  const { error: updateError } = await sb
    .from("club_matches")
    .update({ status: "cancelled" })
    .eq("id", matchId)
    .in("status", ["pending", "in_progress"]);
  if (updateError) return { error: updateError.message };

  revalidatePath(`/clubs/${match.club_id}`);
  return { ok: true };
}

// ─── Locked-Pair Actions ──────────────────────────────────────────────────────

/**
 * Owner / co-admin locks two players as forced teammates for the rotation queue.
 * `games` = null/omitted → locked forever; positive int → lock for N games then
 * auto-release (decrement handled in finish_club_match RPC).
 * Enforces 1-active-lock-per-player at the app layer (a player in one lock can't
 * join another) — mirrors the tournament 1-person-1-pair rule.
 */
export async function createClubLockedPairAction(input: {
  clubId: string;
  player1Id: string;
  player2Id: string;
  games?: number | null;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const { clubId, player1Id, player2Id } = input;
  if (player1Id === player2Id) return { error: "ต้องเลือกผู้เล่น 2 คนที่ต่างกัน" };

  let games: number | null = null;
  if (input.games != null) {
    const g = Math.trunc(input.games);
    if (!Number.isFinite(g) || g < 1) return { error: "จำนวนเกมไม่ถูกต้อง" };
    games = g;
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  // Both players must belong to this club.
  const { data: members } = await sb
    .from("club_players")
    .select("id")
    .eq("club_id", clubId)
    .in("id", [player1Id, player2Id]);
  if (!members || members.length !== 2) return { error: "ไม่พบผู้เล่นในก๊วนนี้" };

  // Create atomically via RPC — it takes a club-row lock + re-checks the
  // 1-active-lock-per-player invariant under the lock (closes the read-then-insert
  // TOCTOU where two concurrent requests could lock the same player twice).
  const { error: rpcError } = await sb.rpc("create_club_locked_pair", {
    p_club_id: clubId,
    p_player1: player1Id,
    p_player2: player2Id,
    p_games: games,
  });
  if (rpcError) {
    if (rpcError.message.includes("player_already_locked")) {
      return { error: "ผู้เล่นถูกล็อคคู่อยู่แล้ว — ปล่อยคู่เดิมก่อน" };
    }
    return { error: rpcError.message };
  }

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

/**
 * Owner / co-admin releases a locked pair (manual unlock before N-games expiry).
 */
export async function releaseClubLockedPairAction(
  lockId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const { data: lock, error: fetchError } = await sb
    .from("club_locked_pairs")
    .select("id, club_id")
    .eq("id", lockId)
    .single();
  if (fetchError || !lock) return { error: "ไม่พบคู่ที่ล็อค" };

  if (!(await assertCanManageClub(sb, lock.club_id, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const { error: deleteError } = await sb
    .from("club_locked_pairs")
    .delete()
    .eq("id", lockId);
  if (deleteError) return { error: deleteError.message };

  revalidatePath(`/clubs/${lock.club_id}`);
  return { ok: true };
}

/**
 * Owner / co-admin sets the shuttle count a match consumed (used by
 * shuttle_split="per_match" cost). UI "+ลูก" passes current + 1.
 */
export async function setClubMatchShuttlesAction(
  matchId: string,
  shuttles: number,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const n = Math.trunc(shuttles);
  if (!Number.isFinite(n) || n < 0 || n > 99) return { error: "จำนวนลูกไม่ถูกต้อง" };

  const sb = await createAdminClient();
  const guard = await loadClubMatchForManage(sb, matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;

  const { error: updateError } = await sb
    .from("club_matches")
    .update({ shuttles_used: n })
    .eq("id", matchId);
  if (updateError) return { error: updateError.message };

  revalidatePath(`/clubs/${match.club_id}`);
  return { ok: true };
}

/**
 * Owner / co-admin manually creates a match (players who request to play each
 * other), bypassing the auto rotation queue. sideA/sideB are 1 id (singles) or
 * 2 ids (doubles) per the club's players_per_team. Inserted as pending at the
 * queue tail. Does NOT block on players already in another queued match — the
 * organizer's request wins.
 */
export async function createClubManualMatchAction(input: {
  clubId: string;
  court: string;
  sideA: string[];
  sideB: string[];
}): Promise<{ ok: true; match: ClubMatch } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const { clubId, sideA, sideB } = input;
  const courtName = input.court.trim();
  if (!courtName) return { error: "ระบุสนาม" };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  // Load players_per_team from settings to validate side sizes.
  const { data: clubRow, error: clubErr } = await sb
    .from("clubs")
    .select("queue_settings")
    .eq("id", clubId)
    .single();
  if (clubErr || !clubRow) return { error: "ไม่พบก๊วนนี้" };
  const ppt = parseQueueSettings(clubRow.queue_settings).players_per_team;

  const cleanA = sideA.filter(Boolean);
  const cleanB = sideB.filter(Boolean);
  if (cleanA.length !== ppt || cleanB.length !== ppt) {
    return { error: ppt === 2 ? "ต้องเลือกฝั่งละ 2 คน" : "ต้องเลือกฝั่งละ 1 คน" };
  }

  const all = [...cleanA, ...cleanB];
  if (new Set(all).size !== all.length) return { error: "ผู้เล่นซ้ำกัน" };

  // All chosen players must belong to this club.
  const { data: members } = await sb
    .from("club_players")
    .select("id")
    .eq("club_id", clubId)
    .in("id", all);
  if (!members || members.length !== all.length) return { error: "ไม่พบผู้เล่นในก๊วนนี้" };

  // queue_position = tail of pending.
  const { data: maxRow } = await sb
    .from("club_matches")
    .select("queue_position")
    .eq("club_id", clubId)
    .eq("status", "pending")
    .order("queue_position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextQueuePosition = (maxRow?.queue_position ?? 0) + 1;

  const { data: newMatch, error: insertError } = await sb
    .from("club_matches")
    .insert({
      club_id: clubId,
      court: courtName,
      side_a_player1: cleanA[0],
      side_a_player2: ppt === 2 ? cleanA[1] : null,
      side_b_player1: cleanB[0],
      side_b_player2: ppt === 2 ? cleanB[1] : null,
      status: "pending",
      queue_position: nextQueuePosition,
    })
    .select()
    .single();
  if (insertError || !newMatch) return { error: insertError?.message ?? "สร้างแมตช์ไม่สำเร็จ" };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true, match: newMatch as ClubMatch };
}

/**
 * Owner / co-admin reorders the pending queue (drag-and-drop). Sets
 * queue_position = 1..N in the given id order. Only touches pending rows of this
 * club (in_progress/completed keep their slots). No DB unique constraint on
 * queue_position, so a straight per-row update is safe (unlike the tournament
 * RPC which guards a unique match_number).
 */
export async function reorderClubQueueAction(
  clubId: string,
  orderedIds: string[],
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { error: "ลำดับคิวไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  // Renumber pending matches in parallel (independent updates) — mirrors
  // reorderPlayersAction; avoids N sequential round-trips on every drag.
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      sb
        .from("club_matches")
        .update({ queue_position: i + 1 })
        .eq("id", id)
        .eq("club_id", clubId)
        .eq("status", "pending"),
    ),
  );
  for (const { error } of results) {
    if (error) return { error: error.message };
  }

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

/**
 * Owner / co-admin deletes a match (wrong entry). Via RPC delete_club_match:
 * a completed match reverts games_played (−1, floor 0) for its players; in_progress
 * never incremented games so nothing to revert. last_finished_at + N-game lock
 * decrements are NOT restored (the UI confirm dialog states this). Removing the row
 * also drops its shuttle contribution (shuttle cost is derived from matches).
 */
export async function deleteClubMatchAction(
  matchId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const guard = await loadClubMatchForManage(sb, matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;

  const { error: rpcError } = await sb.rpc("delete_club_match", { p_match_id: matchId });
  if (rpcError) return { error: rpcError.message };

  revalidatePath(`/clubs/${match.club_id}`);
  return { ok: true };
}

// ─── Levels (global skill-level lookup) ───────────────────────────────────────

const LevelSchema = z.object({
  real: z.coerce.number().min(0).max(100),
  label: z.string().trim().min(1, "ระบุชื่อระดับ").max(20),
  sort_order: z.coerce.number().int().min(0).max(10_000).optional(),
});

/** Public read — levels list ordered for display. */
export async function getLevelsAction(): Promise<Level[]> {
  const sb = await createAdminClient();
  const { data } = await sb
    .from("levels")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("real", { ascending: true });
  return (data ?? []) as Level[];
}

/** Create a skill level (any signed-in LINE user; global reference data). */
export async function createLevelAction(input: {
  real: number;
  label: string;
  sort_order?: number;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session || session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE" };

  const parsed = LevelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const sb = await createAdminClient();
  const { error } = await sb.from("levels").insert({
    real: parsed.data.real,
    label: parsed.data.label,
    sort_order: parsed.data.sort_order ?? Math.round(parsed.data.real * 10),
  });
  if (error) {
    if (error.code === "23505") return { error: "ระดับนี้ (real หรือ label) มีอยู่แล้ว" };
    return { error: error.message };
  }
  revalidatePath("/clubs", "layout");
  return { ok: true };
}

/** Edit a skill level. */
export async function updateLevelAction(input: {
  id: string;
  real: number;
  label: string;
  sort_order?: number;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session || session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE" };

  const parsed = LevelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const sb = await createAdminClient();
  const { error } = await sb
    .from("levels")
    .update({
      real: parsed.data.real,
      label: parsed.data.label,
      ...(parsed.data.sort_order != null ? { sort_order: parsed.data.sort_order } : {}),
    })
    .eq("id", input.id);
  if (error) {
    if (error.code === "23505") return { error: "ระดับนี้ (real หรือ label) มีอยู่แล้ว" };
    return { error: error.message };
  }
  revalidatePath("/clubs", "layout");
  return { ok: true };
}

/** Delete a skill level. Players referencing it have level_id set to NULL (FK ON DELETE SET NULL). */
export async function deleteLevelAction(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session || session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE" };

  const sb = await createAdminClient();
  const { error } = await sb.from("levels").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/clubs", "layout");
  return { ok: true };
}

// ─── Per-player discount + guest rename ───────────────────────────────────────

/** Owner / co-admin sets a player's discount (subtracted from the cost breakdown total). */
export async function updateClubPlayerDiscountAction(
  clubId: string,
  playerId: string,
  discount: number,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const d = Number(discount);
  if (!Number.isFinite(d) || d < 0 || d > 1_000_000) return { error: "ส่วนลดไม่ถูกต้อง" };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb
    .from("club_players")
    .update({ discount: d })
    .eq("id", playerId)
    .eq("club_id", clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

/** Owner / co-admin renames a guest player (profile_id IS NULL — LINE players keep their account name). */
export async function renameClubGuestAction(
  clubId: string,
  playerId: string,
  displayName: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const name = displayName.trim();
  if (name.length < 1 || name.length > 60) return { error: "ชื่อยาว 1–60 ตัวอักษร" };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const { data: player, error: fetchError } = await sb
    .from("club_players")
    .select("id, profile_id")
    .eq("id", playerId)
    .eq("club_id", clubId)
    .single();
  if (fetchError || !player) return { error: "ไม่พบผู้เล่น" };
  if (player.profile_id) return { error: "แก้ชื่อได้เฉพาะผู้เล่น guest" };

  const { error } = await sb
    .from("club_players")
    .update({ display_name: name })
    .eq("id", playerId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}
