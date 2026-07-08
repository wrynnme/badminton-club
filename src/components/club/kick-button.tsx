"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserMinus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { kickPlayerAction } from "@/lib/actions/club-players";

export function KickButton({
  clubId,
  playerId,
  playerName,
}: {
  clubId: string;
  playerId: string;
  playerName?: string;
}) {
  const t = useTranslations("club.kick");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      const fd = new FormData();
      fd.set("club_id", clubId);
      fd.set("player_id", playerId);
      const res = await kickPlayerAction(fd);
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("toastSuccess"));
        setOpen(false);
      }
    });
  }

  const who = playerName ? `"${playerName}"` : t("defaultWho");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              aria-label={t("ariaLabel")}
              onClick={() => setOpen(true)}
            >
              <UserMinus className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <TooltipContent>{t("tooltip")}</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            {t("dialogTitle", { who })}
          </DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>{t("bullet1")}<span className="text-foreground font-medium">{t("bullet1Emph")}</span></li>
          <li>{t("bullet2")}</li>
          <li>{t("bullet3")}</li>
          <li>{t("bullet4")}</li>
        </ul>
        <p className="text-sm font-medium text-destructive">{t("permanent")}</p>

        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" disabled={pending}>{t("cancel")}</Button>}
          />
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? t("deleting") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
