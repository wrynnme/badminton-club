"use client";

import { useTransition } from "react";
import { UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { kickPlayerAction } from "@/lib/actions/clubs";

export function KickButton({ clubId, playerId }: { clubId: string; playerId: string }) {
  const [pending, start] = useTransition();
  return (
    <form action={(fd) => start(async () => { await kickPlayerAction(fd); })}>
      <input type="hidden" name="club_id" value={clubId} />
      <input type="hidden" name="player_id" value={playerId} />
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" type="submit" disabled={pending}>
        <UserMinus className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
