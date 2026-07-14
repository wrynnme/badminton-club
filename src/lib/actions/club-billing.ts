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
  buildGroupBillLines,
  buildGroupBillListMessages,
  type GroupBillPlayer,
} from "@/lib/club/group-billing";
import { getAppSettings } from "@/lib/app-settings";
import { resolveBotMessage } from "@/lib/bot-messages";
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
      /** total roster lines posted (payable + unpaid) */
      billed: number;
      /** linked players rendered as a working @mention */
      mentioned: number;
      /** true if the list exceeded LINE's 5-messages-per-push cap and was clamped */
      overflow: boolean;
    }
  | { error: string };

/**
 * Post ONE consolidated bill into the club's bound LINE group: a numbered roster
 * of who owes what, then a single amount-less PromptPay QR. Linked players are
 * @mentioned (textV2, fires their notification); guests are listed by plain name
 * so they're covered too. The list splits across messages at LINE's 20-mention
 * cap with continuous numbering (see buildGroupBillListMessages).
 *
 * Requires `clubs.line_group_id` (bind the group first via the webhook command).
 * `input.qrImageUrl` is the client-rendered open QR PNG (or the club's uploaded
 * promptpay_qr_image); null → text-only bill (club has no PromptPay). On a
 * successful push, bill_amount + bill_pushed_at are stamped on every listed
 * player; paid_at is never touched here.
 */
export async function pushGroupBillsAction(input: {
  clubId: string;
  /** Hosted amount-less QR image URL attached after the list. The client renders
   *  the open PromptPay QR PNG (from promptpay_id) and uploads it, or passes the
   *  club's uploaded promptpay_qr_image. null → text-only bill (no PromptPay set). */
  qrImageUrl: string | null;
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

  // 4. Build payable player list (unpaid, owes > 0), resolving each LINE id.
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

  // 5. Build the numbered roster list (amount desc, ties keep roster order).
  const lines = buildGroupBillLines(payable);
  if (lines.length === 0) {
    return { error: t("club.noPayable") };
  }

  // 6. Format play_date for the message header.
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

  // 7. Compose the messages (list + QR image) and push ONCE to the group. The
  //    scan prompt is a site-admin-editable template (blank/missing → default).
  const { messages: botMessages } = await getAppSettings();
  const { messages, overflow, sentPlayerIds } = buildGroupBillListMessages({
    lines,
    clubName: club.name,
    dateStr,
    qrImageUrl: input.qrImageUrl,
    scanPrompt: resolveBotMessage(botMessages, "groupBillScanPrompt"),
  });

  const ok = await pushMessagesToGroup(club.line_group_id, messages);
  if (!ok) {
    return { error: t("club.groupPushFailed") };
  }

  // 8. Stamp the bill snapshot — but ONLY on players whose line actually made it
  //    into the push. On overflow the composer drops trailing chunks; stamping the
  //    full roster would mark players "billed" for a message they never received.
  //    Grouped by amount to keep the write count small. paid_at is NOT touched.
  const sentSet = new Set(sentPlayerIds);
  const sentLines = lines.filter((l) => sentSet.has(l.playerId));
  const now = new Date().toISOString();
  const idsByAmount = new Map<number, string[]>();
  for (const line of sentLines) {
    const ids = idsByAmount.get(line.amount) ?? [];
    ids.push(line.playerId);
    idsByAmount.set(line.amount, ids);
  }
  for (const [amount, ids] of idsByAmount) {
    const { error: stampErr } = await sb
      .from("club_players")
      .update({ bill_amount: amount, bill_pushed_at: now })
      .in("id", ids)
      .eq("club_id", input.clubId);
    if (stampErr) {
      console.error(
        "[club-billing] group bill stamp error for amount",
        amount,
        stampErr.message,
      );
    }
  }

  const mentioned = sentLines.filter((l) => l.mentioned).length;
  const plain = sentLines.length - mentioned;

  // 9. Audit + revalidate.
  await sb.from("club_audit_logs").insert({
    club_id: input.clubId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "group_bills_pushed",
    detail: `billed ${sentLines.length}, mentioned ${mentioned}, plain ${plain}, qr ${input.qrImageUrl ? "yes" : "no"}${overflow ? `, overflow (dropped ${lines.length - sentLines.length})` : ""}`,
  });

  revalidatePath(`/clubs/${input.clubId}`);

  return {
    ok: true,
    billed: sentLines.length,
    mentioned,
    overflow,
  };
}
