"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";
import {
  parseQueueSettings,
} from "@/lib/club/queue-settings";
import {
  buildNextMatch,
  buildPartialMatch,
  isClubMatchFull,
  planWinnerStays,
  resolveCourtStay,
  keepsWinner,
  benchSufficientForFresh,
  playersInLatestPerCourt,
  type QueuePlayer,
  type MatchSide,
} from "@/lib/club/queue";
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
    .select("id, club_id, side_a_player1, side_a_player2, side_b_player1, side_b_player2")
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

  const t = await getTranslations("actions");
  const courtName = court.trim();
  if (!courtName) return { error: t("club.specifyCourtName") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  // Load settings.
  const { data: clubRow, error: clubFetchError } = await sb
    .from("clubs")
    .select("queue_settings, courts")
    .eq("id", clubId)
    .single();
  if (clubFetchError || !clubRow) return { error: t("club.clubNotFound") };
  const settings = parseQueueSettings(clubRow.queue_settings);

  // Court must be one of the club's named courts (when any are configured) —
  // mirror setClubMatchCourtAction so a phantom court can't be created.
  const courts = (clubRow.courts ?? []) as string[];
  if (courts.length > 0 && !courts.includes(courtName)) return { error: t("club.courtNotInClub") };

  // Load active players for this club (level resolved via the levels FK).
  // Reserves (status='reserve') are excluded — they wait until promoted and are
  // never drafted into a match by the queue builder.
  const { data: allPlayers, error: playersFetchError } = await sb
    .from("club_players")
    .select("id, position, joined_at, level_id, games_played, last_finished_at, checked_in_at, levels:level_id(real)")
    .eq("club_id", clubId)
    .eq("status", "active");
  if (playersFetchError || !allPlayers) return { error: t("club.loadPlayersFailed") };

  // Collect ids of players already in an active (pending or in_progress) match.
  // `court` is also read so winner_stays can tell which courts are already busy
  // (their winners must NOT be reserved — see planWinnerStays below).
  const { data: activeMatches } = await sb
    .from("club_matches")
    .select("court, side_a_player1, side_a_player2, side_b_player1, side_b_player2")
    .eq("club_id", clubId)
    .in("status", ["pending", "in_progress"]);

  const activePlayers = new Set<string>();
  for (const m of activeMatches ?? []) {
    if (m.side_a_player1) activePlayers.add(m.side_a_player1);
    if (m.side_a_player2) activePlayers.add(m.side_a_player2);
    if (m.side_b_player1) activePlayers.add(m.side_b_player1);
    if (m.side_b_player2) activePlayers.add(m.side_b_player2);
  }

  // Check-in = readiness. When at least one player is checked in, check-in is
  // "in use" and not_ready_action decides what to do with not-ready (not-checked-in)
  // players: "skip" excludes them from the pool (the long-standing default behavior);
  // "requeue" keeps them but the queue sorts them to the tail (drafted only when ready
  // players run short — see QueuePlayer.notReady). When nobody is checked in, check-in
  // isn't in use → everyone is eligible regardless of the setting.
  const anyCheckedIn = allPlayers.some((p) => p.checked_in_at != null);
  const isNotReady = (p: (typeof allPlayers)[number]) =>
    anyCheckedIn && p.checked_in_at == null;

  // Build pool-eligible set: not in active match + (check-in gate if applicable).
  const eligiblePlayers = allPlayers.filter((p) => {
    if (activePlayers.has(p.id)) return false;
    if (isNotReady(p) && settings.not_ready_action === "skip") return false;
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
      // requeue policy keeps not-checked-in players in the pool but at the tail.
      notReady: isNotReady(p),
    };
  };

  let pool: QueuePlayer[] = eligiblePlayers.map(toQueuePlayer);
  let stayingSide: MatchSide | undefined;

  // winner_stays / fair_winner_fallback: keep each court's most-recent winners on
  // THEIR court. We fetch completed matches across ALL courts (not just this one) so
  // building one court RESERVES the other free courts' winners — i.e. excludes them
  // from this court's opponent pool. Without that, building court 1 would draw court 2's
  // winners as opponents, and court 2 would lose its winner on the next build (the old
  // bug: winners only stayed on the first-built court). No winner_side filter — a
  // most-recent no-winner/tie finish must still count as "just played"; resolveCourtStay
  // returns no stayer for a tie-headed court on its own.
  if (keepsWinner(settings.rotation_mode)) {
    const { data: recentMatches } = await sb
      .from("club_matches")
      .select(
        "court, side_a_player1, side_a_player2, side_b_player1, side_b_player2, winner_side, ended_at",
      )
      .eq("club_id", clubId)
      .eq("status", "completed")
      .order("ended_at", { ascending: false })
      .limit(100);

    // Only READY players can be winner-stayers / be reserved for their court. Under
    // `requeue`, eligiblePlayers includes not-ready (not-checked-in) players — they must
    // NOT be force-kept on court ahead of ready waiters, so exclude them here.
    const eligibleIds = new Set(
      eligiblePlayers.filter((p) => !isNotReady(p)).map((p) => p.id),
    );
    // Courts that already hold a pending/in_progress match won't get a winner-stays
    // build right now, so their winners must NOT be reserved (they'd never be drawn).
    const courtsWithActive = new Set(
      (activeMatches ?? []).map((m) => m.court).filter((c): c is string => c != null),
    );

    // ALWAYS plan reservation (both modes) so building this court can't steal another
    // free court's winner. The cap stays the configured value — never globally overridden.
    const plan = planWinnerStays(recentMatches ?? [], {
      currentCourt: courtName,
      courtsWithActiveMatch: courtsWithActive,
      winnerStaysMax: settings.winner_stays_max,
      eligibleIds,
      // Only reserve winners for courts that still exist in the club's config — a
      // removed/renamed court's stale completed rows must not strand players. When the
      // club has no named courts (free-text fallback), reserve any free court.
      reservableCourts: courts.length > 0 ? new Set(courts) : undefined,
    });
    stayingSide = plan.stayingSide ?? undefined;

    // fair_winner_fallback is FAIR by default — this court's winner rotates out too and
    // the longest-rested come in. It only KEEPS this court's winner when the bench can't
    // seat a WHOLE fresh match: bench = players who didn't just play on ANY court (so a
    // player who just finished elsewhere isn't mistaken for rested). winner_stays always
    // keeps the winner (and respects its cap via plan.stayingSide above).
    if (settings.rotation_mode === "fair_winner_fallback") {
      const justPlayedAnywhere = playersInLatestPerCourt(recentMatches ?? []);
      // Bench counts READY players only — not-ready (requeue) players must not make the
      // bench look big enough to seat a whole fresh match (else the ready winner gets
      // rotated out in favor of not-checked-in draftees).
      const readyBench = pool.filter((p) => !p.notReady);
      if (benchSufficientForFresh(readyBench, justPlayedAnywhere, settings.players_per_team)) {
        stayingSide = undefined; // FAIR — drop this court's stayer (others stay reserved)
      } else {
        // FALLBACK: the shortage itself is the throttle, so this court's winner stays
        // regardless of winner_stays_max (cap=0). Other courts' reservation in `plan`
        // keeps the configured cap — the cap is only bypassed for THIS court's stay.
        const thisCourtRows = (recentMatches ?? []).filter((m) => m.court === courtName);
        stayingSide = resolveCourtStay(thisCourtRows, 0, eligibleIds)?.stayingSide ?? undefined;
      }
    }

    // Remove this court's stayer (becomes sideA) AND other free courts' reserved winners
    // (held for their own court) from this court's opponent pool.
    const exclude = new Set<string>(plan.reservedIds);
    if (stayingSide) {
      if (stayingSide.player1) exclude.add(stayingSide.player1);
      if (stayingSide.player2) exclude.add(stayingSide.player2);
    }
    if (exclude.size > 0) pool = pool.filter((p) => !exclude.has(p.id));
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

  // Build the next match. If the pool is too small for a FULL match, fall back to a PARTIAL
  // match (reserve the court with the players available now; the organizer fills the rest
  // inline and can't START until full). The two error paths remain: nobody free at all, or
  // enough bodies but a constraint (skill-gap strict / locked partner absent) blocked it.
  const proposed = buildNextMatch(pool, settings, stayingSide, lockedPairs);
  let slotIds: { a1: string | null; a2: string | null; b1: string | null; b2: string | null };
  if (proposed) {
    slotIds = {
      a1: proposed.sideA.player1,
      a2: proposed.sideA.player2 ?? null,
      b1: proposed.sideB.player1,
      b2: proposed.sideB.player2 ?? null,
    };
  } else {
    // winner_stays only draws the opponents, so it needs ppt (not 2*ppt) more players.
    const needed = stayingSide ? settings.players_per_team : settings.players_per_team * 2;
    const available = pool.length;
    const checkedIn = allPlayers.filter((p) => p.checked_in_at != null).length;
    const playing = activePlayers.size;
    if (available >= needed) {
      // Enough bodies but no valid lineup (skill-gap strict / a locked player's partner is
      // absent). Don't hide that behind a half-filled match — surface it.
      return { error: t("club.cannotFormMatchSkillLock") };
    }
    const partial = available > 0 ? buildPartialMatch(pool, settings, stayingSide) : null;
    if (!partial) {
      return { error: t("club.notEnoughPlayersDetail", { needed, available, checkedIn, playing }) };
    }
    slotIds = partial;
  }

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
      side_a_player1: slotIds.a1,
      side_a_player2: slotIds.a2,
      side_b_player1: slotIds.b1,
      side_b_player2: slotIds.b2,
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
  // Roster-completeness gate: a partial-roster match (reserved with empty slots) may
  // sit in the pending queue but must be fully staffed before it can start.
  const { data: clubRow } = await sb
    .from("clubs")
    .select("queue_settings")
    .eq("id", match.club_id)
    .single();
  const ppt = parseQueueSettings(clubRow?.queue_settings ?? {}).players_per_team;
  if (!isClubMatchFull(match, ppt)) return { error: t("club.matchNotFullToStart") };

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
  court: string;
  sideA: string[];
  sideB: string[];
}): Promise<{ ok: true; match: ClubMatch } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const { clubId, sideA, sideB } = input;
  const courtName = input.court.trim();
  if (!courtName) return { error: t("club.specifyCourtName") };

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

  // Court must be one of the club's named courts (when any are configured).
  const courts = (clubRow.courts ?? []) as string[];
  if (courts.length > 0 && !courts.includes(courtName)) return { error: t("club.courtNotInClub") };

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
      court: courtName,
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
