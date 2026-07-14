"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import QRCode from "qrcode";
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
import { GeneratedQr } from "@/components/club/generated-qr";
import { buildPromptPayPayload, isValidPromptPayId } from "@/lib/club/promptpay";
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
  // One QR-source decision, shared by the preview render and the send handler so
  // the two can never disagree on which QR (if any) is attached.
  const qrSource: "promptpay" | "image" | "none" = ppNumber
    ? "promptpay"
    : qrImage
      ? "image"
      : "none";

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

  function handleSend() {
    startSending(async () => {
      // 1. Resolve the amount-less QR image URL to attach.
      let qrImageUrl: string | null = null;
      if (qrSource === "promptpay") {
        try {
          const dataUrl = await QRCode.toDataURL(buildPromptPayPayload(club.promptpay_id!), {
            errorCorrectionLevel: "H",
            margin: 1,
            width: 600,
          });
          const up = await uploadBillSlipAction({ clubId, kind: "amount", key: "open-qr", dataUrl });
          if ("error" in up) {
            toast.error(up.error);
            return;
          }
          qrImageUrl = up.url;
        } catch {
          toast.error(t("slipRenderFailed"));
          return;
        }
      } else if (qrSource === "image") {
        qrImageUrl = qrImage;
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

          {qrSource !== "none" && (
            // The scan-prompt line the message carries just above the QR image.
            <p className="text-xs text-muted-foreground">{scanPrompt}</p>
          )}

          <div className="flex flex-col items-center gap-2 rounded-lg border p-3">
            <span className="text-xs text-muted-foreground">{t("groupBillQrLabel")}</span>
            {qrSource === "promptpay" ? (
              <GeneratedQr value={buildPromptPayPayload(club.promptpay_id!)} size={160} logoUrl={null} />
            ) : qrSource === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImage!} alt={t("groupBillQrLabel")} className="h-40 w-40 rounded-lg border bg-white object-contain p-1" />
            ) : (
              <p className="text-center text-xs text-muted-foreground">{t("groupBillNoQr")}</p>
            )}
          </div>

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
  );
}
