"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { updateTournamentStatusAction } from "@/lib/actions/tournaments";
import type { TournamentStatus } from "@/lib/types";

export function TournamentStatusControl({
  tournamentId,
  currentStatus,
}: {
  tournamentId: string;
  currentStatus: TournamentStatus;
}) {
  const t = useTranslations("tournament");
  const [isPending, start] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<TournamentStatus | null>(null);

  const STATUSES: { value: TournamentStatus; label: string }[] = [
    { value: "draft", label: t("statusControl.statusDraft") },
    { value: "registering", label: t("statusControl.statusRegistering") },
    { value: "ongoing", label: t("statusControl.statusOngoing") },
    { value: "completed", label: t("statusControl.statusCompleted") },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="text-xs text-muted-foreground shrink-0">{t("statusControl.labelStatus")}</span>
      {STATUSES.map((s) => {
        const isThisPending = isPending && pendingStatus === s.value;
        return (
          <Button
            key={s.value}
            size="sm"
            className="h-7 text-xs px-2.5"
            variant={s.value === currentStatus ? "default" : "outline"}
            disabled={isPending}
            onClick={() => {
              setPendingStatus(s.value);
              start(async () => {
                const res = await updateTournamentStatusAction(tournamentId, s.value);
                if (res?.error) toast.error(res.error);
                else toast.success(t("statusControl.toastChanged", { label: s.label }));
                setPendingStatus(null);
              });
            }}
          >
            {isThisPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {s.label}
          </Button>
        );
      })}
    </div>
  );
}
