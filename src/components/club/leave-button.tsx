"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { leaveClubAction } from "@/lib/actions/club-players";

export function LeaveButton({ clubId }: { clubId: string }) {
  const t = useTranslations("club.leave");
  const [pending, start] = useTransition();
  return (
    <form
      action={(fd) =>
        start(async () => {
          await leaveClubAction(fd);
          toast.success(t("toastSuccess"));
        })
      }
    >
      <input type="hidden" name="club_id" value={clubId} />
      <Button variant="ghost" size="sm" type="submit" disabled={pending}>
        {t("button")}
      </Button>
    </form>
  );
}
