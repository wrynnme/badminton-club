"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { leaveClubAction } from "@/lib/actions/clubs";

export function LeaveButton({ clubId }: { clubId: string }) {
  const [pending, start] = useTransition();
  return (
    <form
      action={(fd) =>
        start(async () => {
          await leaveClubAction(fd);
          toast.success("ถอนชื่อแล้ว");
        })
      }
    >
      <input type="hidden" name="club_id" value={clubId} />
      <Button variant="ghost" size="sm" type="submit" disabled={pending}>
        ถอนชื่อ
      </Button>
    </form>
  );
}
