"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TypedDeleteDialog } from "@/components/club/typed-delete-dialog";
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

  return (
    <TypedDeleteDialog
      renderTrigger={(open) => (
        <Button variant="destructive" onClick={open}>
          <Trash2 className="h-4 w-4" />
          {t("triggerButton")}
        </Button>
      )}
      title={t("dialogTitle", { name: clubName })}
      description={t("dialogDescription")}
      body={
        <>
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
        </>
      }
      expectedName={clubName}
      inputId="confirm-club-name"
      inputLabel={t("confirmLabel", { name: clubName })}
      cancelLabel={t("cancel")}
      confirmLabel={t("confirm")}
      pendingLabel={t("deleting")}
      contentClassName="sm:max-w-md"
      onConfirm={async () => {
        const res = await deleteClubAction(clubId);
        // Success redirects (never returns) -- only an error path lands here.
        if (res?.error) toast.error(res.error);
      }}
    />
  );
}
