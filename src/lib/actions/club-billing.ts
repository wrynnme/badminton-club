"use server";

import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";
import { pushFlexToUser } from "@/lib/notification/line-club";
import { buildPromptPayPayload, isValidPromptPayId } from "@/lib/club/promptpay";
import { computeClubCostRows } from "@/lib/club/cost-summary";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PushClubBillsInput = {
  clubId: string;
  /** When provided, only push to these club_players.id values (must still meet
   *  the payable + unpaid + has-LINE guard). Omit to push to all eligible. */
  playerIds?: string[];
};

export type PushClubBillsResult =
  | { ok: true; pushed: number; failed: number; skippedNoLine: number }
  | { error: string };

// ---------------------------------------------------------------------------
// pushClubBillsAction
// ---------------------------------------------------------------------------

/**
 * Send a LINE Flex bill to every eligible player (payable, unpaid, has LINE id).
 *
 * Eligibility per player:
 *   – cost row total > 0
 *   – paid_at == null  (not yet marked paid)
 *   – resolved line_user_id (via profile_id → profiles.line_user_id)
 *   – if input.playerIds given: must be in that set
 *
 * For each eligible player:
 *   1. Build a PromptPay QR (amount-embedded) when promptpay_id is valid, OR fall
 *      back to the static uploaded QR image, OR send no QR.
 *   2. Push a Flex bubble; on success stamp bill_amount + bill_pushed_at on the
 *      club_players row (paid_at / paid_method are NOT touched here).
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
  // 4. Determine eligible targets.
  // ------------------------------------------------------------------
  const filterSet = input.playerIds ? new Set(input.playerIds) : null;

  // players whose bill must be sent
  const payablePlayers = players.filter((p) => {
    if (filterSet && !filterSet.has(p.id)) return false;
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
  // 5. Format the club play_date for display.
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // 6. Send a Flex bill to each reachable player.
  // ------------------------------------------------------------------
  let pushed = 0;
  let failed = 0;

  for (const player of reachable) {
    const lineUserId = lineUserIdByPlayerId.get(player.id)!;
    const amount = costByPlayerId.get(player.id)!.total;
    const playerName = player.display_name;

    // --- Build QR URL --------------------------------------------------
    let qrUrl: string | null = null;

    if (club.promptpay_id && isValidPromptPayId(club.promptpay_id)) {
      // Amount-embedded dynamic QR — upload as PNG to the public bucket.
      try {
        const payload = buildPromptPayPayload(club.promptpay_id, amount);
        const buf: Buffer = await QRCode.toBuffer(payload, {
          errorCorrectionLevel: "H",
          width: 600,
          margin: 1,
        });

        const storagePath = `${input.clubId}/bill-${player.id}.png`;
        const up = await sb.storage
          .from("club-qr")
          .upload(storagePath, buf, { contentType: "image/png", upsert: true });

        if (!up.error) {
          const { data: pub } = sb.storage
            .from("club-qr")
            .getPublicUrl(storagePath);
          qrUrl = `${pub.publicUrl}?v=${Date.now()}`;
        } else {
          console.error(
            "[club-billing] QR upload error for player",
            player.id,
            up.error.message,
          );
        }
      } catch (err) {
        console.error("[club-billing] QR generation error for player", player.id, err);
      }
    } else if (club.promptpay_qr_image) {
      // Static uploaded QR (no embedded amount).
      qrUrl = club.promptpay_qr_image;
    }

    // --- Build Flex bubble -------------------------------------------
    const bubble = buildBillBubble({
      club,
      playerName,
      amount,
      qrUrl,
      dateStr,
    });

    // --- Push via LINE -----------------------------------------------
    const ok = await pushFlexToUser(
      lineUserId,
      `บิลค่าก๊วน ${club.name} — ฿${amount}`,
      bubble,
    );

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
  // 7. Audit log.
  // ------------------------------------------------------------------
  await sb.from("club_audit_logs").insert({
    club_id: input.clubId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "bills_pushed",
    detail: `pushed ${pushed}, failed ${failed}, no-line ${skippedNoLine}`,
  });

  // ------------------------------------------------------------------
  // 8. Revalidate.
  // ------------------------------------------------------------------
  revalidatePath(`/clubs/${input.clubId}`);

  return { ok: true, pushed, failed, skippedNoLine };
}

// ---------------------------------------------------------------------------
// Flex bubble builder (pure — no side effects)
// ---------------------------------------------------------------------------

function buildBillBubble(params: {
  club: {
    name: string;
    promptpay_id: string | null;
    promptpay_name: string | null;
  };
  playerName: string;
  amount: number;
  qrUrl: string | null;
  dateStr: string;
}) {
  const { club, playerName, amount, qrUrl, dateStr } = params;

  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#2e7d4f",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: `🏸 ${club.name}`,
          color: "#ffffff",
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        ...(dateStr
          ? [
              {
                type: "text",
                text: dateStr,
                color: "#ffffffcc",
                size: "sm",
              },
            ]
          : []),
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: playerName,
          weight: "bold",
          size: "md",
          wrap: true,
        },
        {
          type: "text",
          text: "ยอดที่ต้องชำระ",
          size: "sm",
          color: "#999999",
        },
        {
          type: "text",
          text: `฿${amount.toLocaleString()}`,
          weight: "bold",
          size: "3xl",
          color: "#2e7d4f",
        },
        ...(qrUrl
          ? [
              {
                type: "image",
                url: qrUrl,
                size: "full",
                aspectMode: "fit",
                aspectRatio: "1:1",
                margin: "md",
              },
            ]
          : []),
        {
          type: "text",
          text: qrUrl
            ? "สแกน QR เพื่อจ่ายเงินได้เลย"
            : `โอน ${amount.toLocaleString()} บาท ไปพร้อมเพย์ ${
                club.promptpay_name ?? club.promptpay_id ?? ""
              }`,
          size: "xs",
          color: "#888888",
          wrap: true,
          margin: "md",
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "text",
          text: `พร้อมเพย์ · ${club.promptpay_name ?? ""}`,
          size: "xs",
          color: "#aaaaaa",
          align: "center",
          wrap: true,
        },
      ],
    },
  };
}
