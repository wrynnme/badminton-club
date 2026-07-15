"use server";

/**
 * club-series.ts — server actions for the persistent club entity (ก๊วนถาวร,
 * ADR 0002 `docs/adr/0002-club-series-persistent-entity.md`) introduced in P2:
 * create/open/rename/archive a series, edit its session defaults ("จัดก๊วน"
 * source of truth — decision #15), and manage its member registry + partner
 * pairs (decisions #2/#6/#7/#11/#12/#13). No page/route changes in this slice —
 * see the ADR's phase roadmap for the URL restructure + UI (later P2 work).
 *
 * Guardrails (see ADR "Guardrails for implementers"): never rekey
 * club_players/club_matches/billing off club_id; club tables stay RLS-on
 * no-policy (service-role only); profiles.line_user_id never leaves the server.
 */

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect } from "@/lib/club/permissions";
import { assertCanManageSeries, assertSeriesOwner } from "@/lib/club/series-permissions";
import { revalidateClubTree } from "@/lib/club/revalidate";
import {
  SessionDefaultsSchema,
  parseSessionDefaults,
  type SessionDefaults,
} from "@/lib/club/session-defaults";
import {
  buildLockedPairRows,
  buildRosterSeedRows,
  buildSessionInsert,
  type SeriesMemberForSeed,
  type SeriesPairForSeed,
} from "@/lib/club/open-session";
import type { ClubSeries } from "@/lib/types";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

// ---------------------------------------------------------------------------
// Shared internal: open a brand-new session under an existing series row.
// Used by both createClubSeriesAction (series + its first session) and
// openClubSessionAction (an additional session under an existing series).
// ---------------------------------------------------------------------------

async function openSessionCore(
  sb: AdminClient,
  series: ClubSeries,
  playDate: string,
  actorId: string,
  opts?: { shuttleInfo?: string | null; notes?: string | null },
): Promise<{ clubId: string } | { error: string }> {
  const t = await getTranslations("actions");
  const defaults = parseSessionDefaults(series.session_defaults);
  const insertPayload: Record<string, unknown> = {
    ...buildSessionInsert({ series, defaults, playDate }),
    shuttle_info: opts?.shuttleInfo?.trim() || null,
    notes: opts?.notes?.trim() || null,
  };

  const { data: club, error: clubErr } = await sb
    .from("clubs")
    .insert(insertPayload)
    .select("id")
    .single();
  if (clubErr || !club) return { error: clubErr?.message ?? t("club.openSessionFailed") };
  const clubId = club.id as string;

  const rollback = async (): Promise<void> => {
    await sb.from("clubs").delete().eq("id", clubId);
  };

  // Seed regulars (decision #2) — read the current membership registry fresh
  // (not cached on `series`, which may be stale by the time this runs).
  const { data: memberRows } = await sb
    .from("series_members")
    .select("id, profile_id, canonical_name, default_level_id, is_regular, first_linked_at")
    .eq("series_id", series.id);
  const seedRows = buildRosterSeedRows({
    members: (memberRows ?? []) as SeriesMemberForSeed[],
    maxPlayers: insertPayload.max_players as number,
  });

  const memberIdToPlayerId = new Map<string, string>();
  if (seedRows.length > 0) {
    const { data: inserted, error: seedErr } = await sb
      .from("club_players")
      .insert(
        seedRows.map((r) => ({
          club_id: clubId,
          display_name: r.display_name,
          profile_id: r.profile_id,
          member_id: r.member_id,
          level_id: r.level_id,
          position: r.position,
          status: r.status,
        })),
      )
      .select("id, member_id");
    if (seedErr) {
      await rollback();
      return { error: seedErr.message };
    }
    for (const row of inserted ?? []) {
      if (row.member_id) memberIdToPlayerId.set(row.member_id as string, row.id as string);
    }
  }

  // Seed locked pairs (decision #6) — only pairs whose both members were just seeded.
  const { data: pairRows } = await sb
    .from("series_partner_pairs")
    .select("id, member1_id, member2_id")
    .eq("series_id", series.id);
  const lockedRows = buildLockedPairRows({
    pairs: (pairRows ?? []) as SeriesPairForSeed[],
    playerIdByMemberId: memberIdToPlayerId,
  });
  if (lockedRows.length > 0) {
    const { error: lockErr } = await sb
      .from("club_locked_pairs")
      .insert(lockedRows.map((r) => ({ club_id: clubId, ...r })));
    if (lockErr) {
      await rollback();
      return { error: lockErr.message };
    }
  }

  // Carry co-admins forward from the previously-active session, if any (decision #3 —
  // co-admins stay per-session until P3, so a new session starts blank otherwise).
  if (series.active_session_id) {
    const { data: prevAdmins } = await sb
      .from("club_admins")
      .select("user_id")
      .eq("club_id", series.active_session_id);
    const rows = (prevAdmins ?? [])
      .map((a) => a.user_id as string)
      .filter((uid) => uid !== series.owner_id)
      .map((uid) => ({ club_id: clubId, user_id: uid, added_by: actorId }));
    if (rows.length > 0) {
      const { error: adminErr } = await sb.from("club_admins").insert(rows);
      // 23505 = duplicate co-admin row — never possible on a brand-new club_id,
      // but tolerate it the same way applyClubPresetAction does for consistency.
      if (adminErr && adminErr.code !== "23505") {
        await rollback();
        return { error: adminErr.message };
      }
    }
  }

  const { error: pointerErr } = await sb
    .from("club_series")
    .update({ active_session_id: clubId })
    .eq("id", series.id);
  if (pointerErr) {
    await rollback();
    return { error: pointerErr.message };
  }

  return { clubId };
}

// ---------------------------------------------------------------------------
// Create a new series (+ its first session)
// ---------------------------------------------------------------------------

const CreateSeriesSchema = z.object({
  name: z.string().trim().max(60).optional().default(""),
  isAdhoc: z.boolean(),
  venue: z.string().trim().max(120).optional(),
  playDate: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  maxPlayers: z.coerce.number().int().min(2).max(40),
  shuttleInfo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type CreateClubSeriesInput = z.infer<typeof CreateSeriesSchema>;

export async function createClubSeriesAction(
  input: CreateClubSeriesInput,
): Promise<{ seriesId: string; clubId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const parsed = CreateSeriesSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { isAdhoc, playDate, startTime, endTime, maxPlayers, venue } = parsed.data;

  let name = parsed.data.name.trim();
  if (!name) {
    if (!isAdhoc) return { error: t("club.clubNameTooShort") };
    name = `เฉพาะกิจ ${playDate}`;
  } else if (name.length < 2) {
    return { error: t("club.clubNameTooShort") };
  }

  const sb = await createAdminClient();

  if (!isAdhoc && (await isSeriesNameTaken(sb, session.profileId, name)))
    return { error: t("club.seriesNameTaken") };

  const sessionDefaults = parseSessionDefaults({
    venue: venue?.trim() || null,
    start_time: startTime,
    end_time: endTime,
    max_players: maxPlayers,
  });

  const { data: seriesRow, error: seriesErr } = await sb
    .from("club_series")
    .insert({ owner_id: session.profileId, name, is_adhoc: isAdhoc, session_defaults: sessionDefaults })
    .select("*")
    .single();
  if (seriesErr || !seriesRow) return { error: seriesErr?.message ?? t("club.createClubFailed") };
  const series = seriesRow as ClubSeries;

  const result = await openSessionCore(sb, series, playDate, session.profileId, {
    shuttleInfo: parsed.data.shuttleInfo ?? null,
    notes: parsed.data.notes ?? null,
  });
  if ("error" in result) {
    // Roll back the series row too — a series with zero sessions must never persist.
    await sb.from("club_series").delete().eq("id", series.id);
    return { error: result.error || t("club.openSessionFailed") };
  }

  revalidateClubTree();
  return { seriesId: series.id, clubId: result.clubId };
}

// ---------------------------------------------------------------------------
// Open an additional session under an existing series ("จัดก๊วน")
// ---------------------------------------------------------------------------

const OpenSessionSchema = z.object({
  seriesId: z.string().uuid(),
  playDate: z.string().min(1),
});

export async function openClubSessionAction(input: {
  seriesId: string;
  playDate: string;
}): Promise<{ clubId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const parsed = OpenSessionSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { seriesId, playDate } = parsed.data;

  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, seriesId, session.profileId))) return { error: t("club.noPermission") };

  const { data: seriesRow, error: seriesErr } = await sb
    .from("club_series")
    .select("*")
    .eq("id", seriesId)
    .maybeSingle();
  if (seriesErr || !seriesRow) return { error: t("club.seriesNotFound") };
  const series = seriesRow as ClubSeries;
  if (series.archived_at) return { error: t("club.seriesArchived") };

  const result = await openSessionCore(sb, series, playDate, session.profileId);
  if ("error" in result) return { error: result.error || t("club.openSessionFailed") };

  revalidateClubTree();
  return result;
}

// ---------------------------------------------------------------------------
// Session defaults ("จัดก๊วน" source of truth — decision #15)
// ---------------------------------------------------------------------------

export async function updateSessionDefaultsAction(input: {
  seriesId: string;
  patch: Partial<SessionDefaults>;
}): Promise<{ ok: true; defaults: SessionDefaults } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, input.seriesId, session.profileId)))
    return { error: t("club.noPermission") };

  const { data: seriesRow, error: fetchErr } = await sb
    .from("club_series")
    .select("session_defaults")
    .eq("id", input.seriesId)
    .maybeSingle();
  if (fetchErr || !seriesRow) return { error: t("club.seriesNotFound") };

  const current = parseSessionDefaults(seriesRow.session_defaults);
  const merged = { ...current, ...input.patch };
  const validated = parseSessionDefaults(merged); // re-validate round-trip, never throws

  const { error } = await sb
    .from("club_series")
    .update({ session_defaults: validated })
    .eq("id", input.seriesId);
  if (error) return { error: t("club.defaultsUpdateFailed") };

  revalidateClubTree();
  return { ok: true, defaults: validated };
}

// ---------------------------------------------------------------------------
// Rename / archive / upgrade / active-session pointer / delete
// ---------------------------------------------------------------------------

const RenameSeriesSchema = z.object({ seriesId: z.string().uuid(), name: z.string().trim().min(2).max(60) });

/** A duplicate (owner_id, name) would make the legacy ensureSeriesForClub lookup ambiguous. */
async function isSeriesNameTaken(
  sb: AdminClient,
  ownerId: string,
  name: string,
  excludeSeriesId?: string,
): Promise<boolean> {
  let q = sb.from("club_series").select("id").eq("owner_id", ownerId).eq("name", name).limit(1);
  if (excludeSeriesId) q = q.neq("id", excludeSeriesId);
  const { data } = await q;
  return !!data && data.length > 0;
}

export async function renameClubSeriesAction(input: {
  seriesId: string;
  name: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const parsed = RenameSeriesSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.clubNameTooShort") };

  const sb = await createAdminClient();
  if (!(await assertSeriesOwner(sb, parsed.data.seriesId, session.profileId)))
    return { error: t("club.noPermission") };

  if (await isSeriesNameTaken(sb, session.profileId, parsed.data.name, parsed.data.seriesId))
    return { error: t("club.seriesNameTaken") };

  const { error } = await sb
    .from("club_series")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.seriesId);
  if (error) return { error: error.message };

  revalidateClubTree();
  return { ok: true };
}

export async function archiveClubSeriesAction(input: {
  seriesId: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const sb = await createAdminClient();
  if (!(await assertSeriesOwner(sb, input.seriesId, session.profileId))) return { error: t("club.noPermission") };

  const { error } = await sb
    .from("club_series")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", input.seriesId);
  if (error) return { error: t("club.archiveFailed") };

  revalidateClubTree();
  return { ok: true };
}

export async function unarchiveClubSeriesAction(input: {
  seriesId: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const sb = await createAdminClient();
  if (!(await assertSeriesOwner(sb, input.seriesId, session.profileId))) return { error: t("club.noPermission") };

  const { error } = await sb.from("club_series").update({ archived_at: null }).eq("id", input.seriesId);
  if (error) return { error: t("club.unarchiveFailed") };

  revalidateClubTree();
  return { ok: true };
}

const UpgradeAdhocSchema = z.object({ seriesId: z.string().uuid(), name: z.string().trim() });

/** decision #12 — "อัปเกรดเป็นก๊วนถาวร" = name it + flip is_adhoc; nothing moves. */
export async function upgradeAdhocSeriesAction(input: {
  seriesId: string;
  name: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const parsed = UpgradeAdhocSchema.safeParse(input);
  if (!parsed.success || parsed.data.name.length < 2) return { error: t("club.adhocNameRequired") };

  const sb = await createAdminClient();
  if (!(await assertSeriesOwner(sb, parsed.data.seriesId, session.profileId)))
    return { error: t("club.noPermission") };

  if (await isSeriesNameTaken(sb, session.profileId, parsed.data.name, parsed.data.seriesId))
    return { error: t("club.seriesNameTaken") };

  const { error } = await sb
    .from("club_series")
    .update({ name: parsed.data.name, is_adhoc: false })
    .eq("id", parsed.data.seriesId);
  if (error) return { error: t("club.upgradeSeriesFailed") };

  revalidateClubTree();
  return { ok: true };
}

const SetActiveSessionSchema = z.object({ seriesId: z.string().uuid(), clubId: z.string().uuid() });

/** decision #3 — explicit, manually switchable "นัดปัจจุบัน" pointer. */
export async function setActiveSessionAction(input: {
  seriesId: string;
  clubId: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const parsed = SetActiveSessionSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };

  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, parsed.data.seriesId, session.profileId)))
    return { error: t("club.noPermission") };

  const { data: club, error: clubErr } = await sb
    .from("clubs")
    .select("id, series_id")
    .eq("id", parsed.data.clubId)
    .maybeSingle();
  if (clubErr || !club || club.series_id !== parsed.data.seriesId) return { error: t("club.clubNotFound") };

  const { error } = await sb
    .from("club_series")
    .update({ active_session_id: parsed.data.clubId })
    .eq("id", parsed.data.seriesId);
  if (error) return { error: t("club.setActiveSessionFailed") };

  revalidateClubTree();
  return { ok: true };
}

/**
 * decision #13 — blocked while any session remains (`clubs.series_id` is
 * `ON DELETE RESTRICT`); delete sessions first, or archive instead. Cascade
 * removes members/pairs/link requests when the delete does succeed.
 */
export async function deleteClubSeriesAction(input: { seriesId: string }): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const sb = await createAdminClient();
  if (!(await assertSeriesOwner(sb, input.seriesId, session.profileId))) return { error: t("club.noPermission") };

  const { error } = await sb.from("club_series").delete().eq("id", input.seriesId);
  if (error) {
    if (error.code === "23503") return { error: t("club.seriesHasSessions") };
    return { error: t("club.deleteSeriesFailed") };
  }

  revalidateClubTree();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Member registry (decisions #2/#7/#11)
// ---------------------------------------------------------------------------

function normalizeMemberName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const AddMemberSchema = z.object({
  seriesId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  levelId: z.string().uuid().optional().nullable(),
  isRegular: z.boolean().optional().default(true),
});

/** Name-only member (`profile_id` null) — decision #11, first-class, links LINE later. */
export async function addSeriesMemberAction(input: {
  seriesId: string;
  name: string;
  levelId?: string | null;
  isRegular?: boolean;
}): Promise<{ ok: true; memberId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const parsed = AddMemberSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { seriesId, name, levelId, isRegular } = parsed.data;

  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, seriesId, session.profileId))) return { error: t("club.noPermission") };

  const { data: existing } = await sb
    .from("series_members")
    .select("canonical_name")
    .eq("series_id", seriesId);
  const target = normalizeMemberName(name);
  if ((existing ?? []).some((m) => normalizeMemberName(m.canonical_name as string) === target)) {
    return { error: t("club.memberDuplicate") };
  }

  const { data: inserted, error } = await sb
    .from("series_members")
    .insert({
      series_id: seriesId,
      profile_id: null,
      canonical_name: name,
      default_level_id: levelId ?? null,
      is_regular: isRegular,
    })
    .select("id")
    .single();
  if (error || !inserted) return { error: t("club.addMemberFailed") };

  revalidateClubTree();
  return { ok: true, memberId: inserted.id as string };
}

const UpdateMemberSchema = z.object({
  seriesId: z.string().uuid(),
  memberId: z.string().uuid(),
  patch: z.object({
    canonicalName: z.string().trim().min(1).max(60).optional(),
    defaultLevelId: z.string().uuid().nullable().optional(),
    isRegular: z.boolean().optional(),
  }),
});

export async function updateSeriesMemberAction(input: {
  seriesId: string;
  memberId: string;
  patch: { canonicalName?: string; defaultLevelId?: string | null; isRegular?: boolean };
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const parsed = UpdateMemberSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { seriesId, memberId, patch } = parsed.data;

  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, seriesId, session.profileId))) return { error: t("club.noPermission") };

  const { data: member } = await sb
    .from("series_members")
    .select("id")
    .eq("id", memberId)
    .eq("series_id", seriesId)
    .maybeSingle();
  if (!member) return { error: t("club.memberNotFound") };

  if (patch.canonicalName !== undefined) {
    const target = normalizeMemberName(patch.canonicalName);
    const { data: existing } = await sb
      .from("series_members")
      .select("canonical_name")
      .eq("series_id", seriesId)
      .neq("id", memberId);
    if ((existing ?? []).some((m) => normalizeMemberName(m.canonical_name as string) === target)) {
      return { error: t("club.memberDuplicate") };
    }
  }

  const dbPatch: Record<string, unknown> = {};
  if (patch.canonicalName !== undefined) dbPatch.canonical_name = patch.canonicalName;
  if (patch.defaultLevelId !== undefined) dbPatch.default_level_id = patch.defaultLevelId;
  if (patch.isRegular !== undefined) dbPatch.is_regular = patch.isRegular;
  if (Object.keys(dbPatch).length === 0) return { error: t("club.updatePlayerNoFields") };

  const { error } = await sb.from("series_members").update(dbPatch).eq("id", memberId);
  if (error) return { error: t("club.updateMemberFailed") };

  revalidateClubTree();
  return { ok: true };
}

/**
 * `club_players.member_id` is `ON DELETE SET NULL` and `series_partner_pairs`
 * is `ON DELETE CASCADE` — removing a member automatically detaches every
 * session attendance row that pointed at it and drops any pair it was in.
 */
export async function removeSeriesMemberAction(input: {
  seriesId: string;
  memberId: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, input.seriesId, session.profileId)))
    return { error: t("club.noPermission") };

  const { error } = await sb
    .from("series_members")
    .delete()
    .eq("id", input.memberId)
    .eq("series_id", input.seriesId);
  if (error) return { error: t("club.removeMemberFailed") };

  revalidateClubTree();
  return { ok: true };
}

/** Bulk-clear every member's default_level_id in the series (a fresh-season reset). */
export async function resetSeriesMemberLevelsAction(input: {
  seriesId: string;
}): Promise<{ ok: true; count: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, input.seriesId, session.profileId)))
    return { error: t("club.noPermission") };

  const { data, error } = await sb
    .from("series_members")
    .update({ default_level_id: null })
    .eq("series_id", input.seriesId)
    .not("default_level_id", "is", null)
    .select("id");
  if (error) return { error: t("club.resetMemberLevelsFailed") };

  revalidateClubTree();
  return { ok: true, count: data?.length ?? 0 };
}

// ---------------------------------------------------------------------------
// Partner pairs (decision #6)
// ---------------------------------------------------------------------------

const AddPairSchema = z.object({
  seriesId: z.string().uuid(),
  member1Id: z.string().uuid(),
  member2Id: z.string().uuid(),
});

export async function addSeriesPartnerPairAction(input: {
  seriesId: string;
  member1Id: string;
  member2Id: string;
}): Promise<{ ok: true; pairId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const parsed = AddPairSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { seriesId, member1Id, member2Id } = parsed.data;
  if (member1Id === member2Id) return { error: t("club.selectTwoDifferentPlayers") };

  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, seriesId, session.profileId))) return { error: t("club.noPermission") };

  const { data: members } = await sb
    .from("series_members")
    .select("id")
    .eq("series_id", seriesId)
    .in("id", [member1Id, member2Id]);
  if ((members ?? []).length !== 2) return { error: t("club.memberNotFound") };

  // Mirror the club-session 1-active-lock-per-player rule: neither member may
  // already sit in an existing pair of this series.
  const { data: existingPairs } = await sb
    .from("series_partner_pairs")
    .select("member1_id, member2_id")
    .eq("series_id", seriesId);
  const taken = new Set<string>();
  for (const p of existingPairs ?? []) {
    taken.add(p.member1_id as string);
    taken.add(p.member2_id as string);
  }
  if (taken.has(member1Id) || taken.has(member2Id)) return { error: t("club.pairMemberTaken") };

  const { data: inserted, error } = await sb
    .from("series_partner_pairs")
    .insert({ series_id: seriesId, member1_id: member1Id, member2_id: member2Id })
    .select("id")
    .single();
  if (error || !inserted) return { error: t("club.addPairFailed") };

  revalidateClubTree();
  return { ok: true, pairId: inserted.id as string };
}

export async function removeSeriesPartnerPairAction(input: {
  seriesId: string;
  pairId: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForClub") };

  const sb = await createAdminClient();
  if (!(await assertCanManageSeries(sb, input.seriesId, session.profileId)))
    return { error: t("club.noPermission") };

  const { error } = await sb
    .from("series_partner_pairs")
    .delete()
    .eq("id", input.pairId)
    .eq("series_id", input.seriesId);
  if (error) return { error: t("club.removePairFailed") };

  revalidateClubTree();
  return { ok: true };
}
