"use client";

import { useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GroupBillSlipCard } from "@/components/club/group-bill-slip-card";
import { resolveSlipPayment } from "@/lib/club/slip-payment";
import { renderSlipBlob, blobToDataUrl, SLIP_QR_SETTLE_MS } from "@/components/club/club-slip-card";
import { isValidPromptPayId } from "@/lib/club/promptpay";
import {
  buildGroupBillLines,
  buildGroupBillHeader,
  formatBillAmount,
  GROUP_BILL_SCAN_PROMPT,
  MAX_MENTIONS_PER_MESSAGE,
} from "@/lib/club/group-billing";
import { uploadBillSlipAction } from "@/lib/actions/club-payments";
import { pushGroupBillsAction } from "@/lib/actions/club-billing";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import type { Club } from "@/lib/types";

/** Scale factor for the LIVE slip preview inside the dialog (the full-size 360px
 *  card would make an already-tall roster dialog unwieldy). CSS `zoom` shrinks the
 *  layout box too (unlike transform), so no measuring wrapper is needed. A separate
 *  full-size OFF-SCREEN instance (below) is what actually gets captured for the
 *  LINE push — capturing a scaled node risks size-dependent capture artifacts. */
const PREVIEW_SCALE = 0.72;

type UnpaidPlayer = {
  playerId: string;
  displayName: string;
  amount: number;
  hasLine: boolean;
};

type Props = {
  clubId: string;
  club: Club;
  unpaid: UnpaidPlayer[];
  /** Site-admin-editable "scan the QR" prompt; falls back to the built-in default. */
  scanPrompt?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
};

export function GroupBillDialog({
  clubId,
  club,
  unpaid,
  scanPrompt = GROUP_BILL_SCAN_PROMPT,
  open,
  onOpenChange,
  onDone,
}: Props) {
  const t = useTranslations("club.payment");
  const [sending, startSending] = useTransition();

  // Off-screen full-size GroupBillSlipCard mount used ONLY to capture the PNG sent
  // to LINE (see renderGroupSlipDataUrl below). Mirrors club-payment-collector.tsx's
  // pushSlipContainerRef pattern: mount → flushSync → capture firstElementChild →
  // unmount, kept separate from the scaled-down visual preview further down.
  const captureContainerRef = useRef<HTMLDivElement>(null);
  const [captureMounted, setCaptureMounted] = useState(false);

  // Reuse the exact server helper so the preview list can never drift from what
  // actually gets sent — the real lineUserId is server-only (PII); this fake
  // "linked" token only drives the `mentioned` flag for preview purposes.
  const lines = buildGroupBillLines(
    unpaid.map((u) => ({
      playerId: u.playerId,
      displayName: u.displayName,
      lineUserId: u.hasLine ? "linked" : null,
      amount: u.amount,
    })),
  );

  const mentionedCount = lines.filter((l) => l.mentioned).length;
  const plainCount = lines.length - mentionedCount;
  const chunkCount = Math.ceil(mentionedCount / MAX_MENTIONS_PER_MESSAGE);

  const ppNumber = !!club.promptpay_id && isValidPromptPayId(club.promptpay_id);
  const qrImage = club.promptpay_qr_image || null;
  // Single source of truth for "does the slip actually carry a QR": the same pure
  // resolver GroupBillSlipCard renders from — so the attach decision can never
  // disagree with what the slip body shows (e.g. a club with a PromptPay number
  // but payment_show.promptpay=false must NOT push a slip whose body is the
  // admin-facing empty state). No QR → text-only push, like before this feature.
  const payment = resolveSlipPayment(club, ppNumber, qrImage);
  const hasQr = !!(payment.qrValue || payment.ppImage);

  // LINE bodies are Thai-only by project convention, and the server builds the sent
  // header with dateFnsLocaleOf("th"). Pin the preview to "th" too (NOT the admin's
  // UI locale) so the preview date can't diverge from what actually gets posted.
  let dateStr = "";
  try {
    dateStr = club.play_date
      ? format(new Date(club.play_date), "dd MMM yyyy", { locale: dateFnsLocaleOf("th") })
      : "";
  } catch {
    dateStr = club.play_date ?? "";
  }

  /** Mounts the off-screen GroupBillSlipCard, waits for the commit + QR/font
   *  render, captures it to a PNG, and returns a base64 data URL — or null on
   *  failure. Mirrors `renderOffscreenSlipDataUrl` in club-payment-collector.tsx. */
  async function renderGroupSlipDataUrl(): Promise<string | null> {
    // flushSync forces the off-screen mount to commit synchronously before we read
    // the DOM below — startSending's async callback isn't itself a transition, but
    // this still guards against the node not existing yet on the first paint.
    flushSync(() => setCaptureMounted(true));
    // Give the SlipQr's async QR (qrcode.toDataURL in a useEffect) time to draw.
    await new Promise<void>((resolve) => setTimeout(resolve, SLIP_QR_SETTLE_MS));
    const node = captureContainerRef.current?.firstElementChild as HTMLElement | null;
    if (!node) {
      setCaptureMounted(false);
      return null;
    }
    try {
      const blob = await renderSlipBlob(node);
      return await blobToDataUrl(blob);
    } catch {
      return null;
    } finally {
      setCaptureMounted(false);
    }
  }

  function handleSend() {
    startSending(async () => {
      // 1. Render + upload the slip-styled, amount-less QR image (both the
      //    promptpay-number and uploaded-image branches render inside the same
      //    slip — GroupBillSlipCard picks the right one internally).
      let qrImageUrl: string | null = null;
      if (hasQr) {
        const dataUrl = await renderGroupSlipDataUrl();
        if (!dataUrl) {
          toast.error(t("slipRenderFailed"));
          return;
        }
        const up = await uploadBillSlipAction({ clubId, kind: "amount", key: "open-qr", dataUrl });
        if ("error" in up) {
          toast.error(up.error);
          return;
        }
        qrImageUrl = up.url;
      }

      // 2. Send.
      const res = await pushGroupBillsAction({ clubId, qrImageUrl });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const base = t("groupBillResult", { billed: res.billed, mentioned: res.mentioned });
      const msg = res.overflow ? `${base} · ${t("groupBillOverflowNote")}` : base;
      toast.success(msg);
      onDone();
    });
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("groupBillPreviewTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/* The exact header line the group message will carry. */}
          <p className="font-medium">{buildGroupBillHeader(club.name, dateStr)}</p>

          <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
            {lines.map((line) => (
              <div key={line.playerId} className="flex items-center gap-2 px-3 py-2">
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{line.index}.</span>
                <span className="flex-1 min-w-0 truncate">{line.displayName}</span>
                {line.mentioned && (
                  <Badge variant="secondary" className="shrink-0">
                    {t("groupBillMentionBadge")}
                  </Badge>
                )}
                <span className="shrink-0 font-semibold tabular-nums">{formatBillAmount(line.amount)}</span>
              </div>
            ))}
          </div>

          {hasQr ? (
            <>
              {/* The scan-prompt line the message carries just above the QR image. */}
              <p className="text-xs text-muted-foreground">{scanPrompt}</p>
              {/* Live preview of the exact slip image that gets attached (scaled
                  down to fit the dialog) — the full-size capture instance used for
                  the actual upload is mounted off-screen, below. */}
              <div className="flex justify-center" style={{ zoom: PREVIEW_SCALE }}>
                <GroupBillSlipCard club={club} payment={payment} dateStr={dateStr} />
              </div>
            </>
          ) : (
            <p className="rounded-lg border p-3 text-center text-xs text-muted-foreground">
              {t("groupBillNoQr")}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {t("groupBillCount", { total: lines.length, mentioned: mentionedCount, plain: plainCount })}
          </p>

          {mentionedCount > MAX_MENTIONS_PER_MESSAGE && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("groupBillChunkWarn", { n: chunkCount })}
            </p>
          )}
        </div>

        <DialogFooter>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={sending}
                  onClick={() => onOpenChange(false)}
                />
              }
            >
              {t("groupBillCancel")}
            </TooltipTrigger>
            <TooltipContent>{t("groupBillCancelTip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  disabled={sending || lines.length === 0}
                  onClick={handleSend}
                />
              }
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? t("groupBillSending") : t("groupBillConfirm")}
            </TooltipTrigger>
            <TooltipContent>{t("pushGroupTip")}</TooltipContent>
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Off-screen full-size slip capture — invisible, used only to render the PNG
        that gets uploaded + attached to the push. Mirrors the off-screen container
        pattern in club-payment-collector.tsx (lines ~474-493). */}
    {captureMounted && (
      <div
        ref={captureContainerRef}
        aria-hidden="true"
        style={{ position: "fixed", top: -9999, left: -9999, pointerEvents: "none", zIndex: -1 }}
      >
        <GroupBillSlipCard club={club} payment={payment} dateStr={dateStr} />
      </div>
    )}
    </>
  );
}
