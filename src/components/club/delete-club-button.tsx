"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteClubAction } from "@/lib/actions/clubs";

/**
 * Owner-only destructive "delete club" dialog. Requires the owner to type the
 * club name verbatim before the confirm button enables -- guards against an
 * accidental irreversible delete (every child row cascades away). On success the
 * server action redirects to /clubs, so there's no success branch to handle here.
 */
export function DeleteClubButton({
  clubId,
  clubName,
}: {
  clubId: string;
  clubName: string;
}) {
  const t = useTranslations("club.deleteClub");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();

  const confirmed = typed.trim() === clubName.trim();

  function handleDelete() {
    if (!confirmed) return;
    start(async () => {
      const res = await deleteClubAction(clubId);
      // Success redirects (never returns) -- only an error path lands here.
      if (res?.error) toast.error(res.error);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTyped("");
      }}
    >
      <DialogTrigger
        render={
          <Button variant="destructive">
            <Trash2 className="h-4 w-4" />
            {t("triggerButton")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            {t("dialogTitle", { name: clubName })}
          </DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>
            {t("bullet1Pre")}
            <span className="text-foreground font-medium">
              {t("bullet1")}
            </span>
            {t("bullet1Post")}
          </li>
          <li>{t("bullet2")}</li>
        </ul>
        <p className="text-sm font-medium text-destructive">{t("permanent")}</p>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-club-name">
            {t("confirmLabel", { name: clubName })}
          </Label>
          <Input
            id="confirm-club-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={clubName}
            autoComplete="off"
            disabled={pending}
          />
        </div>

        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" disabled={pending}>{t("cancel")}</Button>}
          />
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!confirmed || pending}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending ? t("deleting") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
