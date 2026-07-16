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
import { normalizeRosterName } from "@/lib/club/line-self-link";
import { revalidateClubTree } from "@/lib/club/revalidate";
import { getGlobalLevelsAction } from "@/lib/actions/levels";
import type { ClubProfileSearchResult } from "@/lib/actions/club-admins";
import {
  SessionDefaultsSchema,
  buildSessionDefaultsFromClub,
  parseSessionDefaults,
  type SessionDefaults,
} from "@/lib/club/session-defaults";
import {
  buildLockedPairRows,
  buildRosterSeedRows,
  buildSessionInsert,
  remapMemberLevelsToGlobal,
  type SeriesMemberForSeed,
  type SeriesPairForSeed,
} from "@/lib/club/open-session";
import type { Club, ClubSeries } from "@/lib/types";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

// ---------------------------------------------------------------------------
// Shared internal: per-action guard prologue.
// ---------------------------------------------------------------------------

/**
 * Session + guest + seriesId-shape + permission gate shared by every series
 * action. `level` picks the permission check: "manage" = owner or a co-admin
 * of any session (`assertCanManageSeries`), "owner" = owner only
 * (`assertSeriesOwner`). A missing session throws Next's login redirect (via
 * `loginRedirect()`, which never returns); every other failure comes back as
 * `{ ok: false, res }` for the action to return as-is. The uuid check makes a
 * malformed seriesId a uniform `club.invalidData` before any DB round-trip.
 */
async function guardSeries(seriesId: string, level: "manage" | "owner") {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) {
    return { ok: false as const, res: { error: t("club.requireLineForClub") } };
  }
  if (!z.string().uuid().safeParse(seriesId).success) {
    return { ok: false as const, res: { error: t("club.invalidData") } };
  }

  const sb = await createAdminClient();
  const allowed =
    level === "owner"
      ? await assertSeriesOwner(sb, seriesId, session.profileId)
      : await assertCanManageSeries(sb, seriesId, session.profileId);
  if (!allowed) return { ok: false as const, res: { error: t("club.noPermission") } };

  return { ok: true as const, sb, t, profileId: session.profileId };
}

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

  // Independent reads in one wave (writes below stay strictly sequenced):
  // membership registry for the regular seed (decision #2 — read fresh, not
  // cached on `series`, which may be stale by the time this runs), partner
  // pairs (decision #6), and the previously-active session's co-admins
  // (decision #3).
  const [memberRes, pairRes, prevAdminRes] = await Promise.all([
    sb
      .from("series_members")
      .select("id, profile_id, canonical_name, default_level_id, is_regular, first_linked_at, default_start_time, default_end_time")
      .eq("series_id", series.id),
    sb.from("series_partner_pairs").select("id, member1_id, member2_id").eq("series_id", series.id),
    series.active_session_id
      ? sb.from("club_admins").select("user_id").eq("club_id", series.active_session_id)
      : Promise.resolve({ data: null }),
  ]);
  const members = (memberRes.data ?? []) as SeriesMemberForSeed[];

  const { data: club, error: clubErr } = await sb
    .from("clubs")
    .insert(insertPayload)
    .select("id")
    .single();
  if (clubErr || !club) return { error: clubErr?.message ?? t("club.openSessionFailed") };
  const clubId = club.id as string;

  const rollback = async (): Promise<void> => {
    const { error: rollbackErr } = await sb.from("clubs").delete().eq("id", clubId);
    if (rollbackErr) {
      // Orphaned half-seeded session — surface loudly so ops can find it.
      console.error(
        `[openSessionCore] rollback failed — orphaned clubs row ${clubId} (series ${series.id})`,
        rollbackErr,
      );
    }
  };

  // Remap club-scoped default_level_id values onto the GLOBAL level set before
  // building seed rows (see `remapMemberLevelsToGlobal` in
  // `src/lib/club/open-session.ts` for the why) — only regulars get seeded, so
  // only their level ids need resolving.
  const scopedLevelIds = Array.from(
    new Set(
      members
        .filter((m) => m.is_regular && m.default_level_id)
        .map((m) => m.default_level_id as string),
    ),
  );
  let remappedMembers = members;
  if (scopedLevelIds.length > 0) {
    const [levelRes, globalLevels] = await Promise.all([
      sb.from("levels").select("id, label, club_id").in("id", scopedLevelIds),
      getGlobalLevelsAction(),
    ]);
    remappedMembers = remapMemberLevelsToGlobal(
      members,
      (levelRes.data ?? []) as { id: string; label: string; club_id: string | null }[],
      globalLevels,
    );
  }

  const seedRows = buildRosterSeedRows({
    members: remappedMembers,
    maxPlayers: insertPayload.max_players as number,
  });

  const memberIdToPlayerId = new Map<string, string>();
  if (seedRows.length > 0) {
    const { data: inserted, error: seedErr } = await sb
      .from("club_players")
      .insert(seedRows.map((r) => ({ club_id: clubId, ...r })))
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
  const lockedRows = buildLockedPairRows({
    pairs: (pairRes.data ?? []) as SeriesPairForSeed[],
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
    const rows = (prevAdminRes.data ?? [])
      .map((a) => a.user_id as string)
      .filter((uid) => uid !== series.owner_id)
      .map((uid) => ({ club_id: clubId, user_id: uid, added_by: actorId }));
    if (rows.length > 0) {
      // Source rows come from the PK-deduped club_admins table onto a
      // brand-new club_id — any insert failure is a real error.
      const { error: adminErr } = await sb.from("club_admins").insert(rows);
      if (adminErr) {
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
type CreateClubSeriesInput = z.infer<typeof CreateSeriesSchema>;

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
    // (If openSessionCore's own club rollback failed, this delete hits the
    // clubs.series_id ON DELETE RESTRICT and fails as well — log the orphan ids.)
    const { error: rollbackErr } = await sb.from("club_series").delete().eq("id", series.id);
    if (rollbackErr) {
      console.error(
        `[createClubSeriesAction] series rollback failed — orphaned club_series row ${series.id}`,
        rollbackErr,
      );
    }
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
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t, profileId } = guard;

  const parsed = OpenSessionSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { seriesId, playDate } = parsed.data;

  const { data: seriesRow, error: seriesErr } = await sb
    .from("club_series")
    .select("*")
    .eq("id", seriesId)
    .maybeSingle();
  if (seriesErr || !seriesRow) return { error: t("club.seriesNotFound") };
  const series = seriesRow as ClubSeries;
  if (series.archived_at) return { error: t("club.seriesArchived") };

  const result = await openSessionCore(sb, series, playDate, profileId);
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
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

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

const AdoptDefaultsSchema = z.object({ seriesId: z.string().uuid(), clubId: z.string().uuid() });

/**
 * decision #15's EXPLICIT adopt path — "ใช้ค่าจากนัดปัจจุบัน" (never implicit
 * copy-forward): snapshot the given session's live config into
 * `session_defaults`, overwriting whatever was there. `clubId` must be a
 * session that belongs to `seriesId` — this is a manager-triggered write, so
 * unlike `openSessionCore`'s READ of session_defaults, this is the reverse
 * direction and only runs from this one explicit action.
 */
export async function adoptSessionAsDefaultsAction(input: {
  seriesId: string;
  clubId: string;
}): Promise<{ ok: true } | { error: string }> {
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

  const parsed = AdoptDefaultsSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { seriesId, clubId } = parsed.data;

  const { data: club, error: clubErr } = await sb.from("clubs").select("*").eq("id", clubId).maybeSingle();
  if (clubErr || !club || (club as Club).series_id !== seriesId) return { error: t("club.clubNotFound") };

  const defaults = parseSessionDefaults(buildSessionDefaultsFromClub(club as Club));
  const { error } = await sb.from("club_series").update({ session_defaults: defaults }).eq("id", seriesId);
  if (error) return { error: t("club.defaultsUpdateFailed") };

  revalidateClubTree();
  return { ok: true };
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
  const guard = await guardSeries(input.seriesId, "owner");
  if (!guard.ok) return guard.res;
  const { sb, t, profileId } = guard;

  const parsed = RenameSeriesSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.clubNameTooShort") };

  if (await isSeriesNameTaken(sb, profileId, parsed.data.name, parsed.data.seriesId))
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
  const guard = await guardSeries(input.seriesId, "owner");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

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
  const guard = await guardSeries(input.seriesId, "owner");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

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
  const guard = await guardSeries(input.seriesId, "owner");
  if (!guard.ok) return guard.res;
  const { sb, t, profileId } = guard;

  const parsed = UpgradeAdhocSchema.safeParse(input);
  if (!parsed.success || parsed.data.name.length < 2) return { error: t("club.adhocNameRequired") };

  if (await isSeriesNameTaken(sb, profileId, parsed.data.name, parsed.data.seriesId))
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
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

  const parsed = SetActiveSessionSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };

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
  const guard = await guardSeries(input.seriesId, "owner");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

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
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

  const parsed = AddMemberSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { seriesId, name, levelId, isRegular } = parsed.data;

  const { data: existing } = await sb
    .from("series_members")
    .select("canonical_name")
    .eq("series_id", seriesId);
  const target = normalizeRosterName(name);
  if ((existing ?? []).some((m) => normalizeRosterName(m.canonical_name as string) === target)) {
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
    // "HH:mm" or null (= present the whole รอบตี); applied to NEWLY-opened
    // sessions only — see buildRosterSeedRows.
    defaultStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    defaultEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  }),
});

export async function updateSeriesMemberAction(input: {
  seriesId: string;
  memberId: string;
  patch: {
    canonicalName?: string;
    defaultLevelId?: string | null;
    isRegular?: boolean;
    defaultStartTime?: string | null;
    defaultEndTime?: string | null;
  };
}): Promise<{ ok: true } | { error: string }> {
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

  const parsed = UpdateMemberSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { seriesId, memberId, patch } = parsed.data;

  const { data: member } = await sb
    .from("series_members")
    .select("id")
    .eq("id", memberId)
    .eq("series_id", seriesId)
    .maybeSingle();
  if (!member) return { error: t("club.memberNotFound") };

  if (patch.canonicalName !== undefined) {
    const target = normalizeRosterName(patch.canonicalName);
    const { data: existing } = await sb
      .from("series_members")
      .select("canonical_name")
      .eq("series_id", seriesId)
      .neq("id", memberId);
    if ((existing ?? []).some((m) => normalizeRosterName(m.canonical_name as string) === target)) {
      return { error: t("club.memberDuplicate") };
    }
  }

  if (
    patch.defaultStartTime != null &&
    patch.defaultEndTime != null &&
    patch.defaultStartTime >= patch.defaultEndTime
  ) {
    return { error: t("club.memberTimeRangeInvalid") };
  }

  const dbPatch: Record<string, unknown> = {};
  if (patch.canonicalName !== undefined) dbPatch.canonical_name = patch.canonicalName;
  if (patch.defaultLevelId !== undefined) dbPatch.default_level_id = patch.defaultLevelId;
  if (patch.isRegular !== undefined) dbPatch.is_regular = patch.isRegular;
  if (patch.defaultStartTime !== undefined) dbPatch.default_start_time = patch.defaultStartTime;
  if (patch.defaultEndTime !== undefined) dbPatch.default_end_time = patch.defaultEndTime;
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
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

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
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

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
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

  const parsed = AddPairSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };
  const { seriesId, member1Id, member2Id } = parsed.data;
  if (member1Id === member2Id) return { error: t("club.selectTwoDifferentPlayers") };

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
  const guard = await guardSeries(input.seriesId, "manage");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

  const { error } = await sb
    .from("series_partner_pairs")
    .delete()
    .eq("id", input.pairId)
    .eq("series_id", input.seriesId);
  if (error) return { error: t("club.removePairFailed") };

  revalidateClubTree();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Co-admins (P3 — lifted from per-session `club_admins`; owner-only management,
// mirrors club-admins.ts' addClubCoAdminAction/removeClubCoAdminAction/
// searchClubProfilesAction, keyed on seriesId + `series_admins` instead of
// clubId + `club_admins`). See assertCanManageSeries for the read side (series
// owner OR series_admins row OR legacy per-session club_admins fallback).
// ---------------------------------------------------------------------------

export type SeriesAdmin = {
  series_id: string;
  user_id: string;
  display_name: string | null;
  line_user_id: string | null;
  added_by: string | null;
  added_at: string;
};

export async function addSeriesCoAdminAction(input: {
  seriesId: string;
  profileId: string;
}): Promise<{ ok: true } | { error: string }> {
  const guard = await guardSeries(input.seriesId, "owner");
  if (!guard.ok) return guard.res;
  const { sb, t, profileId: actorId } = guard;

  const trimmed = input.profileId.trim();
  if (!z.string().uuid().safeParse(trimmed).success) return { error: t("club.selectUserFromSearch") };

  // Resolve by opaque profile id (from searchSeriesProfilesAction) — never by line_user_id.
  const { data: profile } = await sb.from("profiles").select("id").eq("id", trimmed).maybeSingle();
  if (!profile) return { error: t("club.userNotFound") };
  if (profile.id === actorId) return { error: t("club.cannotAddSelfAsCoAdmin") };

  const { error } = await sb.from("series_admins").insert({
    series_id: input.seriesId,
    user_id: profile.id,
    added_by: actorId,
  });
  if (error) {
    if (error.code === "23505") return { error: t("club.alreadyCoAdmin") };
    return { error: t("club.addCoAdminFailed") };
  }

  revalidateClubTree();
  return { ok: true };
}

export async function removeSeriesCoAdminAction(input: {
  seriesId: string;
  userId: string;
}): Promise<{ ok: true } | { error: string }> {
  const guard = await guardSeries(input.seriesId, "owner");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

  const { error } = await sb
    .from("series_admins")
    .delete()
    .eq("series_id", input.seriesId)
    .eq("user_id", input.userId);
  if (error) return { error: t("club.removeCoAdminFailed") };

  revalidateClubTree();
  return { ok: true };
}

export async function listSeriesCoAdminsAction(input: {
  seriesId: string;
}): Promise<{ ok: true; admins: SeriesAdmin[] } | { error: string }> {
  const guard = await guardSeries(input.seriesId, "owner");
  if (!guard.ok) return guard.res;
  const { sb, t } = guard;

  type Row = {
    series_id: string;
    user_id: string;
    added_by: string | null;
    added_at: string;
    profile: { display_name: string | null; line_user_id: string | null } | null;
  };
  const { data, error } = await sb
    .from("series_admins")
    .select("series_id, user_id, added_by, added_at, profile:profiles!series_admins_user_id_fkey(display_name, line_user_id)")
    .eq("series_id", input.seriesId)
    .order("added_at", { ascending: true });
  if (error) return { error: t("club.loadCoAdminsFailed") };

  const admins: SeriesAdmin[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    series_id: r.series_id,
    user_id: r.user_id,
    display_name: r.profile?.display_name ?? null,
    line_user_id: r.profile?.line_user_id ?? null,
    added_by: r.added_by,
    added_at: r.added_at,
  }));
  return { ok: true, admins };
}

/** Mirrors `searchClubProfilesAction` (club-admins.ts), scoped to `series_admins`
 *  instead of `club_admins` — excludes the actor + everyone already a series co-admin. */
export async function searchSeriesProfilesAction(input: {
  seriesId: string;
  query: string;
}): Promise<{ ok: true; results: ClubProfileSearchResult[] } | { error: string }> {
  const guard = await guardSeries(input.seriesId, "owner");
  if (!guard.ok) return guard.res;
  const { sb, t, profileId: actorId } = guard;

  const q = input.query.trim();
  if (q.length < 2) return { ok: true, results: [] };

  const { data: existing } = await sb.from("series_admins").select("user_id").eq("series_id", input.seriesId);
  const excludeIds = [actorId, ...(existing ?? []).map((r) => r.user_id as string)];
  const escapedQ = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  // excludeIds always has actorId — never empty
  const { data, error } = await sb
    .from("profiles")
    // line_user_id is NOT selected (PII) — only used as a server-side filter to
    // exclude guests (null line_user_id), never returned to the client.
    .select("id, display_name")
    .ilike("display_name", `%${escapedQ}%`)
    .not("line_user_id", "is", null)
    .not("id", "in", `(${excludeIds.join(",")})`)
    .limit(20);
  if (error) return { error: t("club.searchFailed") };
  return { ok: true, results: (data ?? []) as ClubProfileSearchResult[] };
}
