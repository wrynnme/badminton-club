"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";
import {
  parseQueueSettings,
  type ClubQueueSettings,
} from "@/lib/club/queue-settings";
import { resolveClubCourts } from "@/lib/club/courts";
import {
  buildNextMatch,
  buildPartialMatch,
  isClubMatchFull,
  planWinnerStays,
  resolveCourtStay,
  keepsWinner,
  benchSufficientForFresh,
  playersInLatestPerCourt,
  orderPool,
  takeSides,
  type QueuePlayer,
  type MatchSide,
} from "@/lib/club/queue";
import {
  generateBatchQueue,
  buildPairHistory,
  countFixedAppearances,
  resolvePlayerWindow,
  proRatedTarget,
  type BatchCountableMatch,
} from "@/lib/club/batch-queue";
import type { ClubMatch, Game } from "@/lib/types";

/**
 * Fetch a club_match by id + verify the caller can manage its club. Shared by the
 * match-lifecycle actions (start / finish / cancel / shuttles / delete) to replace
 * the repeated fetch → not-found → assertCanManageClub block.
 */
async function loadClubMatchForManage(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  matchId: string,
  profileId: string,
): Promise<
  | {
      match: {
        id: string;
        club_id: string;
        status: string;
        court: string | null;
        side_a_player1: string | null;
        side_a_player2: string | null;
        side_b_player1: string | null;
        side_b_player2: string | null;
      };
    }
  | { error: string }
> {
  const t = await getTranslations("actions");
  const { data: match, error } = await sb
    .from("club_matches")
    .select("id, club_id, status, court, side_a_player1, side_a_player2, side_b_player1, side_b_player2")
    .eq("id", matchId)
    .single();
  if (error || !match) return { error: t("club.matchNotFound") };
  if (!(await assertCanManageClub(sb, match.club_id, profileId))) {
    return { error: t("club.noPermission") };
  }
  return { match };
}

/**
 * Validate + clean a manual/edited match roster — shared by createClubManualMatchAction
 * (new pending match) and setClubMatchPlayersAction (edit a pending match). Partial
 * rosters allowed: each side ≤ ppt, ≥1 player overall, all distinct, all members of the
 * club. Returns the cleaned per-side id arrays (empty slots simply absent) or a
 * translated error. The caller maps cleanA[0]/cleanA[1]/… onto the side_*_player* columns.
 */
async function resolveMatchSides(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  clubId: string,
  sideA: string[],
  sideB: string[],
  ppt: number,
  t: Awaited<ReturnType<typeof getTranslations>>,
): Promise<{ cleanA: string[]; cleanB: string[] } | { error: string }> {
  const cleanA = sideA.filter(Boolean);
  const cleanB = sideB.filter(Boolean);
  if (cleanA.length > ppt || cleanB.length > ppt) {
    return { error: ppt === 2 ? t("club.mustSelectTwoPerSide") : t("club.mustSelectOnePerSide") };
  }
  if (cleanA.length + cleanB.length < 1) return { error: t("club.mustSelectAtLeastOnePlayer") };

  const all = [...cleanA, ...cleanB];
  if (new Set(all).size !== all.length) return { error: t("club.duplicatePlayer") };

  // All chosen players must belong to this club.
  const { data: members } = await sb
    .from("club_players")
    .select("id")
    .eq("club_id", clubId)
    .in("id", all);
  if (!members || members.length !== all.length) return { error: t("club.playerNotInClub") };

  return { cleanA, cleanB };
}

// ─── Batch queue ("สุ่มคิว") ───────────────────────────────────────────────────

type QueueContext = {
  settings: ClubQueueSettings;
  courts: string[];
  clubStart: string;
  clubEnd: string;
  /** check-in-gated eligible players — INCLUDES players in active matches (the
   *  batch generator accounts for those via the per-player remaining counts) */
  pool: QueuePlayer[];
  /** ids currently in a pending / in_progress match */
  activePlayerIds: Set<string>;
  lockedPairs: [string, string][];
  /** raw eligible rows — carries the pro-rate fields (start/end/check-in) */
  playerRows: Array<{
    id: string;
    start_time: string | null;
    end_time: string | null;
    checked_in_at: string | null;
  }>;
};

/**
 * Shared pool assembly for the batch-queue actions: settings + named courts +
 * active roster (check-in gate / not_ready_action applied, level resolved via
 * the levels FK) + busy-player set + locked pairs. Mirrors the eligibility
 * rules of the per-court builder.
 */
async function loadClubQueueContext(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  clubId: string,
  t: Awaited<ReturnType<typeof getTranslations>>,
): Promise<QueueContext | { error: string }> {
  const { data: clubRow, error: clubFetchError } = await sb
    .from("clubs")
    .select("queue_settings, courts, start_time, end_time")
    .eq("id", clubId)
    .single();
  if (clubFetchError || !clubRow) return { error: t("club.clubNotFound") };
  const settings = parseQueueSettings(clubRow.queue_settings);
  const courts = resolveClubCourts((clubRow.courts ?? []) as string[], settings.court_count);

  const { data: allPlayers, error: playersFetchError } = await sb
    .from("club_players")
    .select(
      "id, position, joined_at, level_id, games_played, last_finished_at, checked_in_at, start_time, end_time, levels:level_id(real)",
    )
    .eq("club_id", clubId)
    .eq("status", "active");
  if (playersFetchError || !allPlayers) return { error: t("club.loadPlayersFailed") };

  const { data: activeMatches } = await sb
    .from("club_matches")
    .select("side_a_player1, side_a_player2, side_b_player1, side_b_player2")
    .eq("club_id", clubId)
    .in("status", ["pending", "in_progress"]);
  const activePlayerIds = new Set<string>();
  for (const m of activeMatches ?? []) {
    for (const id of [m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2]) {
      if (id) activePlayerIds.add(id);
    }
  }

  const anyCheckedIn = allPlayers.some((p) => p.checked_in_at != null);
  const isNotReady = (p: (typeof allPlayers)[number]) =>
    anyCheckedIn && p.checked_in_at == null;
  const eligible = allPlayers.filter(
    (p) => !(isNotReady(p) && settings.not_ready_action === "skip"),
  );

  const pool: QueuePlayer[] = eligible.map((p) => {
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
      notReady: isNotReady(p),
    };
  });

  const { data: lockRows } = await sb
    .from("club_locked_pairs")
    .select("player1_id, player2_id")
    .eq("club_id", clubId);
  const lockedPairs: [string, string][] = (lockRows ?? []).map((r) => [
    r.player1_id,
    r.player2_id,
  ]);

  return {
    settings,
    courts,
    clubStart: (clubRow.start_time as string).slice(0, 5),
    clubEnd: (clubRow.end_time as string).slice(0, 5),
    pool,
    activePlayerIds,
    lockedPairs,
    playerRows: eligible.map((p) => ({
      id: p.id,
      start_time: p.start_time,
      end_time: p.end_time,
      checked_in_at: p.checked_in_at,
    })),
  };
}

const GenerateQueueSchema = z.object({
  minMatches: z.number().int().min(1).max(20),
});

/**
 * "สุ่มคิว" — generate the whole session's queue in one press: courtless pending
 * matches such that every eligible player reaches their PRO-RATED minimum of N
 * fixed appearances (N scaled by the fraction of the session they're present;
 * see resolvePlayerWindow / proRatedTarget). Re-pressing tops up: existing
 * fixed appearances (pending + in_progress + completed) count toward the
 * target and only the shortfall is generated — nothing is deleted.
 *
 * winner_stays / fair_winner_fallback generate court-count lanes whose chained
 * matches carry a "ผู้ชนะจากแมตช์ #N" placeholder side, wired via the
 * winner_next_match_id/slot forward pointer (promotion in finish_club_match).
 */
export async function generateClubQueueAction(
  clubId: string,
  input: { minMatches: number },
): Promise<{ ok: true; created: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const parsed = GenerateQueueSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const ctx = await loadClubQueueContext(sb, clubId, t);
  if ("error" in ctx) return ctx;

  // Remember the organizer's N as the dialog default for next time.
  if (ctx.settings.batch_min_matches !== parsed.data.minMatches) {
    await sb
      .from("clubs")
      .update({ queue_settings: { ...ctx.settings, batch_min_matches: parsed.data.minMatches } })
      .eq("id", clubId);
  }

  // Top-up: everything already scheduled or played this session counts.
  const { data: allMatches, error: matchesError } = await sb
    .from("club_matches")
    .select("status, side_a_player1, side_a_player2, side_b_player1, side_b_player2")
    .eq("club_id", clubId);
  if (matchesError) return { error: matchesError.message };
  const countable = (allMatches ?? []) as BatchCountableMatch[];
  const existing = countFixedAppearances(countable);
  // Seed variety from who has already partnered / opposed whom tonight, so a
  // top-up avoids repeating the matchups that are already queued or played.
  const history = buildPairHistory(countable);

  // Per-player pro-rated target. checked_in_at is a UTC timestamp — convert to
  // Bangkok wall-clock HH:MM so it lines up with the club's start/end times.
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  });
  const remaining = new Map<string, number>();
  for (const row of ctx.playerRows) {
    const window = resolvePlayerWindow({
      declaredStart: row.start_time?.slice(0, 5) ?? null,
      declaredEnd: row.end_time?.slice(0, 5) ?? null,
      checkedInHHMM: row.checked_in_at ? hhmm.format(new Date(row.checked_in_at)) : null,
      clubStart: ctx.clubStart,
      clubEnd: ctx.clubEnd,
    });
    const target = proRatedTarget(parsed.data.minMatches, window, ctx.clubStart, ctx.clubEnd);
    remaining.set(row.id, Math.max(0, target - (existing.get(row.id) ?? 0)));
  }

  const plans = generateBatchQueue({
    pool: ctx.pool,
    settings: ctx.settings,
    lockedPairs: ctx.lockedPairs,
    remaining,
    laneCount: ctx.courts.length,
    history,
  });
  if (plans.length === 0) {
    if (ctx.pool.length < ctx.settings.players_per_team * 2) {
      return { error: t("club.generateNotEnoughPlayers") };
    }
    return { error: t("club.generateNothingToDo") };
  }

  // Queue tail for the whole batch.
  const { data: maxRow } = await sb
    .from("club_matches")
    .select("queue_position")
    .eq("club_id", clubId)
    .eq("status", "pending")
    .order("queue_position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = maxRow?.queue_position ?? 0;

  // Phase 1: insert all rows (courtless; winnerOf sides = empty slots).
  const rows = plans.map((plan, i) => ({
    club_id: clubId,
    court: null,
    side_a_player1: plan.sideA.kind === "players" ? plan.sideA.player1 : null,
    side_a_player2: plan.sideA.kind === "players" ? plan.sideA.player2 : null,
    side_b_player1: plan.sideB.kind === "players" ? plan.sideB.player1 : null,
    side_b_player2: plan.sideB.kind === "players" ? plan.sideB.player2 : null,
    status: "pending",
    queue_position: base + i + 1,
  }));
  const { data: inserted, error: insertError } = await sb
    .from("club_matches")
    .insert(rows)
    .select("id");
  if (insertError || !inserted || inserted.length !== plans.length) {
    return { error: insertError?.message ?? t("club.generateFailed") };
  }

  // Phase 2: wire winner pointers on the feeder rows. Not atomic with phase 1 —
  // a failure here leaves chainless matches that degrade to editable empty
  // slots (accepted; see plan). The generator only puts winnerOf in sideA.
  for (let i = 0; i < plans.length; i++) {
    const sideA = plans[i].sideA;
    if (sideA.kind !== "winnerOf") continue;
    const { error: pointerError } = await sb
      .from("club_matches")
      .update({
        winner_next_match_id: inserted[i].id as string,
        winner_next_match_slot: "a",
      })
      .eq("id", inserted[sideA.sourceIndex].id as string);
    if (pointerError) return { error: pointerError.message };
  }

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true, created: plans.length };
}

/**
 * "รื้อคิว แล้วสุ่มใหม่" — clear every NOT-yet-started (pending) match and
 * regenerate the whole upcoming queue from scratch, so the freshness logic
 * gets to re-plan matchups the earlier queue may have repeated. In-progress
 * and completed matches are never touched, and they still seed the variety
 * memory (so the new queue keeps spreading partners/opponents away from what
 * has already happened tonight). Destructive to pending only — the UI guards
 * it behind a confirm dialog.
 */
export async function regenerateClubQueueAction(
  clubId: string,
  input: { minMatches: number },
): Promise<{ ok: true; created: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const parsed = GenerateQueueSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // Which rows are we clearing?
  const { data: pendingRows, error: pendingError } = await sb
    .from("club_matches")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "pending");
  if (pendingError) return { error: pendingError.message };
  const pendingIds = (pendingRows ?? []).map((r) => r.id as string);

  if (pendingIds.length > 0) {
    // Drop any winner-chain pointer aimed at a row we're about to delete first,
    // so no feeder (in-progress, completed, or another pending) is left with a
    // dangling reference when the rows go.
    const { error: clearError } = await sb
      .from("club_matches")
      .update({ winner_next_match_id: null, winner_next_match_slot: null })
      .eq("club_id", clubId)
      .in("winner_next_match_id", pendingIds);
    if (clearError) return { error: clearError.message };

    const { error: deleteError } = await sb
      .from("club_matches")
      .delete()
      .eq("club_id", clubId)
      .eq("status", "pending");
    if (deleteError) return { error: deleteError.message };
  }

  // With pending gone, a plain top-up rebuilds the whole queue from the
  // remaining (in-progress + completed) appearances.
  return generateClubQueueAction(clubId, { minMatches: parsed.data.minMatches });
}

/**
 * "จัดคิวใหม่" — re-roll ONE pending match's fixed players from the freshest
 * pool (the match's own players return to the pool and may be re-picked when
 * they're still the fairest choice). Court, queue position and winner pointers
 * are untouched. A live "ผู้ชนะจากแมตช์ #N" placeholder side is left alone —
 * only the fixed side re-rolls, and the feeder's fixed players stay excluded
 * (the promoted winner may BE them).
 */
export async function rebuildClubPendingMatchAction(
  matchId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  const guard = await loadClubMatchForManage(sb, matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;
  if (match.status !== "pending") return { error: t("club.rebuildOnlyPending") };

  const ctx = await loadClubQueueContext(sb, match.club_id, t);
  if ("error" in ctx) return ctx;
  const ppt = ctx.settings.players_per_team;

  // Live feeder pointing at this match → that side is a placeholder.
  const { data: feeder } = await sb
    .from("club_matches")
    .select(
      "winner_next_match_slot, side_a_player1, side_a_player2, side_b_player1, side_b_player2",
    )
    .eq("winner_next_match_id", matchId)
    .in("status", ["pending", "in_progress"])
    .limit(1)
    .maybeSingle();
  const placeholderSlot =
    feeder?.winner_next_match_slot === "a" || feeder?.winner_next_match_slot === "b"
      ? feeder.winner_next_match_slot
      : null;

  const own = new Set(
    [match.side_a_player1, match.side_a_player2, match.side_b_player1, match.side_b_player2].filter(
      (x): x is string => x != null,
    ),
  );
  const feederIds = new Set(
    feeder
      ? [feeder.side_a_player1, feeder.side_a_player2, feeder.side_b_player1, feeder.side_b_player2].filter(
          (x): x is string => x != null,
        )
      : [],
  );
  // Free players + this match's own players (released back), minus the feeder's.
  const pool = ctx.pool.filter(
    (p) => (!ctx.activePlayerIds.has(p.id) || own.has(p.id)) && !feederIds.has(p.id),
  );

  let update: Record<string, string | null>;
  if (placeholderSlot) {
    const partnerOf = new Map<string, string>();
    if (ppt === 2) {
      for (const [a, b] of ctx.lockedPairs) {
        partnerOf.set(a, b);
        partnerOf.set(b, a);
      }
    }
    const poolIds = new Set(pool.map((p) => p.id));
    const selectable = pool.filter((p) => {
      const partner = partnerOf.get(p.id);
      return partner == null || poolIds.has(partner);
    });
    const sides = takeSides(orderPool(selectable, ctx.settings), partnerOf, 1, ppt);
    if (!sides) return { error: t("club.rebuildNoPlayers") };
    const side = sides[0];
    update =
      placeholderSlot === "a"
        ? { side_b_player1: side.player1, side_b_player2: side.player2 ?? null }
        : { side_a_player1: side.player1, side_a_player2: side.player2 ?? null };
  } else {
    const proposed = buildNextMatch(pool, ctx.settings, undefined, ctx.lockedPairs);
    if (!proposed) return { error: t("club.rebuildNoPlayers") };
    update = {
      side_a_player1: proposed.sideA.player1,
      side_a_player2: proposed.sideA.player2 ?? null,
      side_b_player1: proposed.sideB.player1,
      side_b_player2: proposed.sideB.player2 ?? null,
    };
  }

  const { data: updated, error: updateError } = await sb
    .from("club_matches")
    .update(update)
    .eq("id", matchId)
    .eq("status", "pending")
    .select("id");
  if (updateError) return { error: updateError.message };
  if (!updated || updated.length === 0) return { error: t("club.rebuildOnlyPending") };

  revalidatePath(`/clubs/${match.club_id}`);
  return { ok: true };
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

  const t = await getTranslations("actions");
  // Court gate: batch-generated matches start courtless — the organizer must
  // assign a court before starting (keeps the in_progress occupancy index able
  // to do its job; a NULL court would slip past it).
  if (!match.court || !match.court.trim()) return { error: t("club.matchNeedsCourtToStart") };

  // Roster-completeness gate: a partial-roster match (reserved with empty slots) may
  // sit in the pending queue but must be fully staffed before it can start.
  const { data: clubRow } = await sb
    .from("clubs")
    .select("queue_settings")
    .eq("id", match.club_id)
    .single();
  const ppt = parseQueueSettings(clubRow?.queue_settings ?? {}).players_per_team;
  if (!isClubMatchFull(match, ppt)) {
    // Distinguish "waiting for a winner" (a live feeder still points here) from
    // an ordinary partial roster — the fix for each is different for the user.
    const { data: feeder } = await sb
      .from("club_matches")
      .select("id")
      .eq("winner_next_match_id", matchId)
      .in("status", ["pending", "in_progress"])
      .limit(1)
      .maybeSingle();
    return {
      error: feeder ? t("club.matchWaitingForWinner") : t("club.matchNotFullToStart"),
    };
  }

  const { error: updateError } = await sb
    .from("club_matches")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", matchId)
    .eq("status", "pending");

  if (updateError) {
    if (updateError.code === "23505") return { error: t("club.courtHasActiveMatch") };
    // trg_club_match_player_guard: a player on this match is already in another
    // in_progress match of the club (closes the concurrent double-start race).
    if (updateError.message.includes("club_player_busy")) {
      return { error: t("club.playerBusyInAnotherCourt") };
    }
    return { error: updateError.message };
  }

  revalidatePath(`/clubs/${match.club_id}`);
  return { ok: true };
}

/**
 * Owner / co-admin moves a pending or in_progress match to another court.
 * Completed / cancelled matches keep their (historical) court. Moving an
 * in_progress match onto a court that already has a live match raises 23505 via
 * the partial UNIQUE index (club_id, court) WHERE status='in_progress'.
 */
export async function setClubMatchCourtAction(input: {
  matchId: string;
  court: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const guard = await loadClubMatchForManage(sb, input.matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;

  const t = await getTranslations("actions");
  const court = input.court.trim();
  if (!court) return { error: t("club.selectCourt") };

  // Court must be one of the club's named courts (when the club has any configured).
  const { data: club } = await sb
    .from("clubs")
    .select("courts")
    .eq("id", match.club_id)
    .single();
  const courts = (club?.courts ?? []) as string[];
  if (courts.length > 0 && !courts.includes(court)) {
    return { error: t("club.courtNotInClub") };
  }

  // Only movable while pending / in_progress. The status filter no-ops (0 rows)
  // for completed/cancelled rows → reported below.
  const { data: updated, error } = await sb
    .from("club_matches")
    .update({ court })
    .eq("id", input.matchId)
    .in("status", ["pending", "in_progress"])
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { error: t("club.courtHasActiveMatch") };
    return { error: error.message };
  }
  if (!updated) return { error: t("club.matchCannotChangeCourt") };

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
  games?: Game[];
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  const guard = await loadClubMatchForManage(sb, input.matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;

  const t = await getTranslations("actions");
  // Validate caller-supplied winner/games — a server action is a directly-invokable
  // POST endpoint and TS types are erased at runtime. The winner is chosen MANUALLY
  // (winnerSide ∈ {a,b}); per-set scores are kept only as a record, so they carry no
  // tie constraint. Each game is two integers in [0, 99]; cap the set count so the
  // jsonb stays bounded. Otherwise garbage flows straight into the RPC.
  if (input.winnerSide != null && input.winnerSide !== "a" && input.winnerSide !== "b") {
    return { error: t("club.invalidWinner") };
  }
  const games = input.games ?? [];
  if (!Array.isArray(games) || games.length > 9) {
    return { error: t("club.invalidGames") };
  }
  for (const g of games) {
    if (
      g == null ||
      !Number.isInteger(g.a) || g.a < 0 || g.a > 99 ||
      !Number.isInteger(g.b) || g.b < 0 || g.b > 99
    ) {
      return { error: t("club.invalidScore") };
    }
  }

  // games is the per-set detail; legacy score_a/score_b are left null on new rows
  // (display prefers games). winner_side is the manual pick, honored as-is.
  const { error: rpcError } = await sb.rpc("finish_club_match", {
    p_match_id: input.matchId,
    p_winner_side: input.winnerSide ?? null,
    p_score_a: null,
    p_score_b: null,
    p_games: games,
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

  const t = await getTranslations("actions");
  const { clubId, player1Id, player2Id } = input;
  if (player1Id === player2Id) return { error: t("club.selectTwoDifferentPlayers") };

  let games: number | null = null;
  if (input.games != null) {
    const g = Math.trunc(input.games);
    if (!Number.isFinite(g) || g < 1) return { error: t("club.invalidGameCount") };
    games = g;
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  // Both players must belong to this club.
  const { data: members } = await sb
    .from("club_players")
    .select("id")
    .eq("club_id", clubId)
    .in("id", [player1Id, player2Id]);
  if (!members || members.length !== 2) return { error: t("club.playerNotInClub") };

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
      return { error: t("club.playerAlreadyLocked") };
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

  const t = await getTranslations("actions");
  const { data: lock, error: fetchError } = await sb
    .from("club_locked_pairs")
    .select("id, club_id")
    .eq("id", lockId)
    .single();
  if (fetchError || !lock) return { error: t("club.lockedPairNotFound") };

  if (!(await assertCanManageClub(sb, lock.club_id, session.profileId))) return { error: t("club.noPermission") };

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

  const t = await getTranslations("actions");
  const n = Math.trunc(shuttles);
  if (!Number.isFinite(n) || n < 0 || n > 99) return { error: t("club.invalidShuttleCount") };

  const sb = await createAdminClient();
  const guard = await loadClubMatchForManage(sb, matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;

  const { error: updateError } = await sb
    .from("club_matches")
    .update({ shuttles_used: n })
    .eq("id", matchId)
    .neq("status", "cancelled"); // shuttles only feed cost for non-cancelled matches
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
  /** optional — omitted/blank = courtless (assign later, required before start) */
  court?: string;
  sideA: string[];
  sideB: string[];
}): Promise<{ ok: true; match: ClubMatch } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const { clubId, sideA, sideB } = input;
  const courtName = input.court?.trim() ?? "";

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  // Load players_per_team from settings to validate side sizes.
  const { data: clubRow, error: clubErr } = await sb
    .from("clubs")
    .select("queue_settings, courts")
    .eq("id", clubId)
    .single();
  if (clubErr || !clubRow) return { error: t("club.clubNotFound") };
  const ppt = parseQueueSettings(clubRow.queue_settings).players_per_team;

  // Court (when given) must be one of the club's named courts (when any are configured).
  const courts = (clubRow.courts ?? []) as string[];
  if (courtName && courts.length > 0 && !courts.includes(courtName)) {
    return { error: t("club.courtNotInClub") };
  }

  // Partial roster allowed: reserve a match/court with as few as 1 player and fill the
  // rest later (setClubMatchPlayersAction). Starting is separately gated on a full
  // roster (isClubMatchFull).
  const resolved = await resolveMatchSides(sb, clubId, sideA, sideB, ppt, t);
  if ("error" in resolved) return { error: resolved.error };
  const { cleanA, cleanB } = resolved;

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
      court: courtName || null,
      side_a_player1: cleanA[0] ?? null,
      side_a_player2: cleanA[1] ?? null,
      side_b_player1: cleanB[0] ?? null,
      side_b_player2: cleanB[1] ?? null,
      status: "pending",
      queue_position: nextQueuePosition,
    })
    .select()
    .single();
  if (insertError || !newMatch) return { error: insertError?.message ?? t("club.createMatchFailed") };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true, match: newMatch as ClubMatch };
}

/**
 * Owner / co-admin edits the players of a PENDING match (fill in a partial roster,
 * swap players, or clear a slot). Only pending matches are editable — once started,
 * the roster is frozen. sideA/sideB are 0..ppt ids each; ≥1 player overall. Empty
 * slots become null (the match stays in the queue but can't START until full).
 */
export async function setClubMatchPlayersAction(input: {
  matchId: string;
  sideA: string[];
  sideB: string[];
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  const guard = await loadClubMatchForManage(sb, input.matchId, session.profileId);
  if ("error" in guard) return { error: guard.error };
  const { match } = guard;

  const t = await getTranslations("actions");

  // Load players_per_team to bound each side's size.
  const { data: clubRow } = await sb
    .from("clubs")
    .select("queue_settings")
    .eq("id", match.club_id)
    .single();
  const ppt = parseQueueSettings(clubRow?.queue_settings ?? {}).players_per_team;

  const resolved = await resolveMatchSides(sb, match.club_id, input.sideA, input.sideB, ppt, t);
  if ("error" in resolved) return { error: resolved.error };
  const { cleanA, cleanB } = resolved;

  // Only a pending match's roster is editable. The status filter no-ops (0 rows) for
  // in_progress/completed/cancelled → reported as matchCannotEditPlayers (also covers
  // the race where the match was started between load and update).
  const { data: updated, error } = await sb
    .from("club_matches")
    .update({
      side_a_player1: cleanA[0] ?? null,
      side_a_player2: cleanA[1] ?? null,
      side_b_player1: cleanB[0] ?? null,
      side_b_player2: cleanB[1] ?? null,
    })
    .eq("id", input.matchId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!updated) return { error: t("club.matchCannotEditPlayers") };

  revalidatePath(`/clubs/${match.club_id}`);
  return { ok: true };
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

  const t = await getTranslations("actions");
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { error: t("club.invalidQueueOrder") };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  // orderedIds must be exactly this club's pending set (no stale/foreign/dup ids).
  // Otherwise unmatched ids no-op while matched ones get positions by array index,
  // silently producing gaps / collisions in queue_position.
  const { data: pendingRows } = await sb
    .from("club_matches")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "pending");
  const pendingIds = new Set((pendingRows ?? []).map((r) => r.id));
  if (
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.length !== pendingIds.size ||
    !orderedIds.every((id) => pendingIds.has(id))
  ) {
    return { error: t("club.invalidQueueOrder") };
  }

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
