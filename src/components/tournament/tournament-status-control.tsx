"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateTournamentStatusAction } from "@/lib/actions/tournaments";
import type { TournamentStatus } from "@/lib/types";

const STATUSES: { value: TournamentStatus; label: string }[] = [
  { value: "draft", label: "แบบร่าง" },
  { value: "registering", label: "เปิดรับสมัคร" },
  { value: "ongoing", label: "กำลังแข่ง" },
  { value: "completed", label: "จบแล้ว" },
];

export function TournamentStatusControl({
  tournamentId,
  currentStatus,
}: {
  tournamentId: string;
  currentStatus: TournamentStatus;
}) {
  const [isPending, start] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<TournamentStatus | null>(null);

  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="text-xs text-muted-foreground shrink-0">สถานะ:</span>
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
                else toast.success(`เปลี่ยนสถานะเป็น "${s.label}"`);
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
