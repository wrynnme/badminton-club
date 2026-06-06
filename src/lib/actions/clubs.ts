"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import {
  type ClubQueueSettings,
  ClubQueueSettingsSchema,
  parseQueueSettings,
} from "@/lib/club/queue-settings";
import { buildNextMatch, type QueuePlayer, type MatchSide } from "@/lib/club/queue";
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
  court: number,
): Promise<{ ok: true; match: ClubMatch } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  // Validate court is a positive integer.
  const courtInt = Math.trunc(court);
  if (!Number.isFinite(courtInt) || courtInt < 1) return { error: "หมายเลขสนามไม่ถูกต้อง" };

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

  // Load all players for this club.
  const { data: allPlayers, error: playersFetchError } = await sb
    .from("club_players")
    .select("id, position, joined_at, level, games_played, last_finished_at, checked_in_at")
    .eq("club_id", clubId);
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

  // Map to QueuePlayer (NaN level → null).
  const toQueuePlayer = (p: (typeof eligiblePlayers)[number]): QueuePlayer => {
    const raw = p.level != null && p.level !== "" ? parseFloat(p.level) : null;
    const level = raw != null && !Number.isNaN(raw) ? raw : null;
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
      .eq("court", courtInt)
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

  // Build the proposed match.
  const proposed = buildNextMatch(pool, settings, stayingSide);
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
      court: courtInt,
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

  // Fetch the match first to get club_id for auth.
  const { data: match, error: fetchError } = await sb
    .from("club_matches")
    .select("id, club_id, status")
    .eq("id", matchId)
    .single();
  if (fetchError || !match) return { error: "ไม่พบแมตช์" };

  if (!(await assertCanManageClub(sb, match.club_id, session.profileId))) return { error: "ไม่มีสิทธิ์" };

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

  const { data: match, error: fetchError } = await sb
    .from("club_matches")
    .select("id, club_id")
    .eq("id", input.matchId)
    .single();
  if (fetchError || !match) return { error: "ไม่พบแมตช์" };

  if (!(await assertCanManageClub(sb, match.club_id, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const { error: rpcError } = await sb.rpc("finish_club_match", {
    p_match_id: input.matchId,
    p_winner_side: input.winnerSide ?? null,
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

  const { data: match, error: fetchError } = await sb
    .from("club_matches")
    .select("id, club_id")
    .eq("id", matchId)
    .single();
  if (fetchError || !match) return { error: "ไม่พบแมตช์" };

  if (!(await assertCanManageClub(sb, match.club_id, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const { error: updateError } = await sb
    .from("club_matches")
    .update({ status: "cancelled" })
    .eq("id", matchId)
    .in("status", ["pending", "in_progress"]);
  if (updateError) return { error: updateError.message };

  revalidatePath(`/clubs/${match.club_id}`);
  return { ok: true };
}
