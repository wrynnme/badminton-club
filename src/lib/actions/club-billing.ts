"use server";

import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";
import { pushImageToUser, pushMessagesToGroup } from "@/lib/notification/line-club";
import { computeClubCostRows } from "@/lib/club/cost-summary";
import {
  bucketBillsByAmount,
  buildGroupBillMessages,
  type GroupBillPlayer,
} from "@/lib/club/group-billing";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PushClubBillsInput = {
  clubId: string;
  /** Client-rendered bill slip PNG URL (from `uploadBillSlipAction`, kind='player'),
   *  keyed by club_players.id. Players not present here are skipped (skippedNoSlip)
   *  — the server never falls back to generating its own QR/bubble. */
  slipUrlByPlayerId: Record<string, string>;
};

export type PushClubBillsResult =
  | {
      ok: true;
      pushed: number;
      failed: number;
      skippedNoLine: number;
      skippedNoSlip: number;
    }
  | { error: string };

// ---------------------------------------------------------------------------
// pushClubBillsAction
// ---------------------------------------------------------------------------

/**
 * Send the client-rendered bill slip PNG to every eligible player (payable,
 * unpaid, has LINE id, AND present in `input.slipUrlByPlayerId`).
 *
 * Eligibility per player:
 *   – cost row total > 0
 *   – paid_at == null  (not yet marked paid)
 *   – resolved line_user_id (via profile_id → profiles.line_user_id)
 *   – club_players.id present as a key in input.slipUrlByPlayerId
 *
 * The server never generates a QR or bubble itself — the caller renders the
 * slip client-side, uploads it via `uploadBillSlipAction`, and passes the
 * resulting URL here. Players missing a slip URL are counted in
 * `skippedNoSlip` and never pushed.
 *
 * For each eligible player: push a single LINE image message; on success
 * stamp bill_amount + bill_pushed_at on the club_players row (paid_at /
 * paid_method are NOT touched here).
 *
 * After the loop inserts one club_audit_logs row and revalidates the club path.
 */
export async function pushClubBillsAction(
  input: PushClubBillsInput,
): Promise<PushClubBillsResult> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();

  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // ------------------------------------------------------------------
  // 1. Fetch all data needed to compute costs (mirrors page.tsx fetches).
  // ------------------------------------------------------------------
  const [clubRes, playersRes, matchesRes, expensesRes] = await Promise.all([
    sb.from("clubs").select("*").eq("id", input.clubId).single(),
    sb
      .from("club_players")
      .select("*")
      .eq("club_id", input.clubId)
      .order("position", { ascending: true, nullsFirst: false })
      .order("joined_at", { ascending: true }),
    sb
      .from("club_matches")
      .select("*")
      .eq("club_id", input.clubId)
      .order("queue_position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    sb
      .from("club_expenses")
      .select("*")
      .eq("club_id", input.clubId)
      .order("created_at", { ascending: true }),
  ]);

  if (clubRes.error || !clubRes.data) {
    return { error: clubRes.error?.message ?? t("club.invalidData") };
  }

  const club = clubRes.data;
  const players = playersRes.data ?? [];
  const matches = matchesRes.data ?? [];
  const expenses = (expensesRes.data ?? []) as Array<{
    amount: number | string;
    payer_player_ids: string[];
  }>;

  // ------------------------------------------------------------------
  // 2. Compute per-player cost rows.
  // ------------------------------------------------------------------
  const { rows: costRows } = computeClubCostRows({
    club,
    players,
    matches,
    expenses,
  });

  // Build a quick lookup: club_players.id → cost row
  const costByPlayerId = new Map(costRows.map((r) => [r.playerId, r]));

  // ------------------------------------------------------------------
  // 3. Resolve LINE user ids via profiles table.
  // ------------------------------------------------------------------
  const profileIds = players
    .map((p) => p.profile_id)
    .filter((pid): pid is string => pid !== null);

  let lineUserIdByProfileId = new Map<string, string | null>();
  if (profileIds.length > 0) {
    const { data: profileRows } = await sb
      .from("profiles")
      .select("id, line_user_id")
      .in("id", profileIds);

    lineUserIdByProfileId = new Map(
      (profileRows ?? []).map((pr) => [pr.id, pr.line_user_id]),
    );
  }

  // club_players.id → line_user_id (null when profile missing or no LINE)
  const lineUserIdByPlayerId = new Map<string, string | null>(
    players.map((p) => [
      p.id,
      p.profile_id ? (lineUserIdByProfileId.get(p.profile_id) ?? null) : null,
    ]),
  );

  // ------------------------------------------------------------------
  // 4. Determine eligible targets — every payable + unpaid player is a
  //    candidate (independent of whether a slip was uploaded). Reachable
  //    players missing a slip URL are reported via skippedNoSlip in the
  //    loop below, not silently dropped from the eligibility set.
  // ------------------------------------------------------------------
  // players whose bill must be sent
  const payablePlayers = players.filter((p) => {
    const cost = costByPlayerId.get(p.id);
    if (!cost || cost.total <= 0) return false;
    if (p.paid_at !== null) return false; // already paid
    return true;
  });

  // Split into reachable (have LINE) vs skipped
  const reachable = payablePlayers.filter(
    (p) => !!lineUserIdByPlayerId.get(p.id),
  );
  const skippedNoLine = payablePlayers.length - reachable.length;

  // ------------------------------------------------------------------
  // 5. Send the slip image to each reachable player.
  // ------------------------------------------------------------------
  let pushed = 0;
  let failed = 0;
  let skippedNoSlip = 0;

  for (const player of reachable) {
    const lineUserId = lineUserIdByPlayerId.get(player.id)!;
    const amount = costByPlayerId.get(player.id)!.total;

    const url = input.slipUrlByPlayerId[player.id];
    if (!url) {
      skippedNoSlip++;
      continue;
    }

    // --- Push via LINE -----------------------------------------------
    const ok = await pushImageToUser(lineUserId, url);

    if (ok) {
      // Stamp bill_amount + bill_pushed_at; do NOT touch paid_at/paid_method.
      const { error: updateErr } = await sb
        .from("club_players")
        .update({
          bill_amount: amount,
          bill_pushed_at: new Date().toISOString(),
        })
        .eq("id", player.id)
        .eq("club_id", input.clubId);

      if (updateErr) {
        console.error(
          "[club-billing] Failed to stamp bill_pushed_at for player",
          player.id,
          updateErr.message,
        );
      }
      pushed++;
    } else {
      failed++;
    }
  }

  // ------------------------------------------------------------------
  // 6. Audit log.
  // ------------------------------------------------------------------
  await sb.from("club_audit_logs").insert({
    club_id: input.clubId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bills_pushed",
    detail: `pushed ${pushed}, failed ${failed}, no-line ${skippedNoLine}, no-slip ${skippedNoSlip}`,
  });

  // ------------------------------------------------------------------
  // 7. Revalidate.
  // ------------------------------------------------------------------
  revalidatePath(`/clubs/${input.clubId}`);

  return { ok: true, pushed, failed, skippedNoLine, skippedNoSlip };
}

// ---------------------------------------------------------------------------
// pushGroupBillsAction — collect money inside the club's bound LINE group
// ---------------------------------------------------------------------------

export type PushGroupBillsResult =
  | {
      ok: true;
      /** distinct amounts posted (one message-group each) */
      amountsPushed: number;
      /** players @mentioned across all messages */
      playersTagged: number;
      /** payable players in a bucket with no linked LINE account (not tagged) */
      skippedNoLine: number;
      /** amount buckets with no client-rendered slip URL — not pushed, not stamped */
      skippedNoSlip: number;
      /** true if any bucket exceeded LINE's 5-messages-per-push cap */
      overflow: boolean;
    }
  | { error: string };

/**
 * Post bills into the club's bound LINE group, bucketed by amount owed. For each
 * distinct amount: one client-rendered slip image + one text message @mentioning
 * every payable player who owes that amount (e.g. 170 → @bee @pang, 90 → @bank @boy).
 *
 * Requires `clubs.line_group_id` (bind the group first via the webhook command).
 * Guest players (no linked LINE) still owe the amount but can't be tagged — they
 * count toward `skippedNoLine`. Buckets missing a slip URL in
 * `input.slipUrlByAmount` are skipped entirely (`skippedNoSlip`) — the server
 * never generates its own QR/bubble. bill_amount / bill_pushed_at are stamped on
 * every player in a successfully-posted bucket; paid_at is never touched here.
 */
export async function pushGroupBillsAction(input: {
  clubId: string;
  /** Client-rendered bill slip PNG URL (from `uploadBillSlipAction`, kind='amount'),
   *  keyed by `String(amount)`. Buckets not present here are skipped (skippedNoSlip). */
  slipUrlByAmount: Record<string, string>;
}): Promise<PushGroupBillsResult> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();

  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // 1. Fetch data (mirrors pushClubBillsAction / page.tsx).
  const [clubRes, playersRes, matchesRes, expensesRes] = await Promise.all([
    sb.from("clubs").select("*").eq("id", input.clubId).single(),
    sb
      .from("club_players")
      .select("*")
      .eq("club_id", input.clubId)
      .order("position", { ascending: true, nullsFirst: false })
      .order("joined_at", { ascending: true }),
    sb
      .from("club_matches")
      .select("*")
      .eq("club_id", input.clubId)
      .order("queue_position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    sb
      .from("club_expenses")
      .select("*")
      .eq("club_id", input.clubId)
      .order("created_at", { ascending: true }),
  ]);

  if (clubRes.error || !clubRes.data) {
    return { error: clubRes.error?.message ?? t("club.invalidData") };
  }

  const club = clubRes.data;
  if (!club.line_group_id) {
    return { error: t("club.noLineGroup") };
  }

  const players = playersRes.data ?? [];
  const matches = matchesRes.data ?? [];
  const expenses = (expensesRes.data ?? []) as Array<{
    amount: number | string;
    payer_player_ids: string[];
  }>;

  // 2. Compute per-player cost rows.
  const { rows: costRows } = computeClubCostRows({
    club,
    players,
    matches,
    expenses,
  });
  const costByPlayerId = new Map(costRows.map((r) => [r.playerId, r]));

  // 3. Resolve LINE user ids via profiles.
  const profileIds = players
    .map((p) => p.profile_id)
    .filter((pid): pid is string => pid !== null);

  let lineUserIdByProfileId = new Map<string, string | null>();
  if (profileIds.length > 0) {
    const { data: profileRows } = await sb
      .from("profiles")
      .select("id, line_user_id")
      .in("id", profileIds);
    lineUserIdByProfileId = new Map(
      (profileRows ?? []).map((pr) => [pr.id, pr.line_user_id]),
    );
  }
  const lineUserIdByPlayerId = new Map<string, string | null>(
    players.map((p) => [
      p.id,
      p.profile_id ? (lineUserIdByProfileId.get(p.profile_id) ?? null) : null,
    ]),
  );

  // 4. Build payable player list → bucket by amount.
  const payable: GroupBillPlayer[] = players
    .filter((p) => {
      const cost = costByPlayerId.get(p.id);
      if (!cost || cost.total <= 0) return false;
      if (p.paid_at !== null) return false;
      return true;
    })
    .map((p) => ({
      playerId: p.id,
      displayName: p.display_name,
      lineUserId: lineUserIdByPlayerId.get(p.id) ?? null,
      amount: costByPlayerId.get(p.id)!.total,
    }));

  const buckets = bucketBillsByAmount(payable);
  if (buckets.length === 0) {
    return { error: t("club.noPayable") };
  }

  // 5. Format play_date for the message header.
  let dateStr = "";
  if (club.play_date) {
    try {
      dateStr = format(new Date(club.play_date), "dd MMM yyyy", {
        locale: dateFnsLocaleOf("th"),
      });
    } catch {
      dateStr = club.play_date;
    }
  }

  // 6. Per amount: look up the client-rendered slip, compose messages, push to
  //    the group, stamp bills.
  let amountsPushed = 0;
  let playersTagged = 0;
  let skippedNoLine = 0;
  let skippedNoSlip = 0;
  let overflowAny = false;

  for (const bucket of buckets) {
    skippedNoLine += bucket.unreachable.length;

    const slipUrl = input.slipUrlByAmount[String(bucket.amount)] ?? null;
    if (!slipUrl) {
      skippedNoSlip++;
      continue;
    }

    const { messages, overflow } = buildGroupBillMessages(bucket, {
      clubName: club.name,
      slipUrl,
      dateStr,
    });
    if (overflow) overflowAny = true;

    const ok = await pushMessagesToGroup(club.line_group_id, messages);
    if (!ok) continue;

    amountsPushed++;
    playersTagged += bucket.members.length;

    // Stamp bill snapshot on every player in this bucket (bill was posted to the
    // group they're all in). paid_at / paid_method are NOT touched.
    const bucketIds = [
      ...bucket.members.map((m) => m.playerId),
      ...bucket.unreachable.map((u) => u.playerId),
    ];
    const { error: stampErr } = await sb
      .from("club_players")
      .update({
        bill_amount: bucket.amount,
        bill_pushed_at: new Date().toISOString(),
      })
      .in("id", bucketIds)
      .eq("club_id", input.clubId);
    if (stampErr) {
      console.error(
        "[club-billing] group bill stamp error for amount",
        bucket.amount,
        stampErr.message,
      );
    }
  }

  // 7. Audit + revalidate.
  await sb.from("club_audit_logs").insert({
    club_id: input.clubId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "group_bills_pushed",
    detail: `amounts ${amountsPushed}, tagged ${playersTagged}, no-line ${skippedNoLine}, no-slip ${skippedNoSlip}`,
  });

  revalidatePath(`/clubs/${input.clubId}`);

  return {
    ok: true,
    amountsPushed,
    playersTagged,
    skippedNoLine,
    skippedNoSlip,
    overflow: overflowAny,
  };
}
