"use client";

import { useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { confirmSlipAction, rejectSlipAction } from "@/lib/actions/club-billing";

const baht = (n: number) => `฿${n.toLocaleString()}`;

export type ReviewItem = {
  slipId: string;
  signedUrl: string | null;
  playerName: string;
  amountDetected: number | null;
  billAmount: number | null;
  createdAt: string;
};

type Props = { clubId: string; items: ReviewItem[] };

export function ClubSlipReview({ clubId, items }: Props) {
  const t = useTranslations("club.payment");

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("reviewTitle", { n: items.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <SlipReviewRow key={item.slipId} clubId={clubId} item={item} />
        ))}
      </CardContent>
    </Card>
  );
}

function SlipReviewRow({ clubId, item }: { clubId: string; item: ReviewItem }) {
  const t = useTranslations("club.payment");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await confirmSlipAction({ clubId, slipId: item.slipId });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("reviewConfirmed"));
        router.refresh();
      }
    });
  }

  function handleReject() {
    startTransition(async () => {
      const res = await rejectSlipAction({ clubId, slipId: item.slipId });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("reviewRejected"));
        router.refresh();
      }
    });
  }

  return (
    <div className="flex gap-3 rounded-xl border p-3">
      {/* Slip image */}
      <div className="shrink-0">
        {item.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.signedUrl}
            alt={item.playerName}
            className="h-24 w-24 rounded border object-cover"
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded border bg-muted text-center text-[11px] text-muted-foreground">
            {t("reviewNoImage")}
          </div>
        )}
      </div>

      {/* Info + actions */}
      <div className="flex flex-1 flex-col justify-between gap-2 min-w-0">
        <div className="space-y-0.5">
          <p className="font-semibold text-sm truncate">{item.playerName}</p>
          <p className="text-xs text-muted-foreground">
            {t("reviewDetected", {
              amount:
                item.amountDetected != null
                  ? baht(item.amountDetected)
                  : "—",
            })}
            {" · "}
            {t("reviewBill", {
              amount: item.billAmount != null ? baht(item.billAmount) : "—",
            })}
          </p>
        </div>

        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={pending}
                  onClick={handleConfirm}
                />
              }
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {t("reviewConfirm")}
            </TooltipTrigger>
            <TooltipContent>{t("reviewConfirmTip")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs text-destructive border-destructive/50 hover:bg-destructive/10"
                  disabled={pending}
                  onClick={handleReject}
                />
              }
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              {t("reviewReject")}
            </TooltipTrigger>
            <TooltipContent>{t("reviewRejectTip")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
