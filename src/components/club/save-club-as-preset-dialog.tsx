"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { saveClubAsPresetAction } from "@/lib/actions/club-presets";
import type { ClubPreset } from "@/lib/types";

const NEW_PRESET = "__new__";

type Props = {
  clubId: string;
  defaultName: string;
  presets: Pick<ClubPreset, "id" | "name">[];
  summary: {
    coAdminCount: number;
    regularCount: number;
    hasPromptPay: boolean;
    hasQrImage: boolean;
    hasBank: boolean;
    themeLabel: string;
  };
};

export function SaveClubAsPresetDialog({
  clubId,
  defaultName,
  presets,
  summary,
}: Props) {
  const t = useTranslations("club.savePresetFromClub");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState(NEW_PRESET);
  const [name, setName] = useState(defaultName);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [pending, start] = useTransition();

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === targetId) ?? null,
    [presets, targetId],
  );
  const isOverwrite = targetId !== NEW_PRESET;

  function openDialog() {
    setTargetId(NEW_PRESET);
    setName(defaultName);
    setConfirmOverwrite(false);
    setOpen(true);
  }

  function onTargetChange(value: string | null) {
    if (!value) return;
    setTargetId(value);
    setConfirmOverwrite(false);
    if (value === NEW_PRESET) {
      setName(defaultName);
      return;
    }
    const preset = presets.find((item) => item.id === value);
    if (preset) setName(preset.name);
  }

  function save() {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      toast.error(t("nameTooShort"));
      return;
    }
    if (isOverwrite && !confirmOverwrite) {
      toast.error(t("confirmRequired"));
      return;
    }

    start(async () => {
      const res = await saveClubAsPresetAction({
        clubId,
        name: trimmedName,
        presetId: isOverwrite ? targetId : null,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(res.mode === "updated" ? t("toastUpdated") : t("toastCreated"));
      setOpen(false);
      router.refresh();
    });
  }

  const copiedParts = [
    summary.hasPromptPay ? t("summaryPromptPay") : null,
    summary.hasQrImage ? t("summaryQr") : null,
    summary.hasBank ? t("summaryBank") : null,
    t("summaryTheme", { theme: summary.themeLabel }),
    t("summaryCoAdmins", { count: summary.coAdminCount }),
    t("summaryRegulars", { count: summary.regularCount }),
  ].filter((part): part is string => Boolean(part));

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" variant="outline" size="sm" onClick={openDialog}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {t("trigger")}
            </Button>
          }
        />
        <TooltipContent>{t("triggerTip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="preset-target">{t("targetLabel")}</Label>
              <Select value={targetId} onValueChange={onTargetChange}>
                <SelectTrigger id="preset-target" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_PRESET}>{t("targetNew")}</SelectItem>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="preset-name">{t("nameLabel")}</Label>
              <Input
                id="preset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("namePlaceholder")}
              />
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{t("summaryTitle")}</p>
              <p className="mt-1 text-muted-foreground">
                {copiedParts.join(" · ")}
              </p>
            </div>

            {isOverwrite && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                <p>
                  {t("overwriteWarning", {
                    name: selectedPreset?.name ?? "",
                  })}
                </p>
                <label className="mt-2 flex items-center gap-2">
                  <Checkbox
                    checked={confirmOverwrite}
                    onCheckedChange={(value) => setConfirmOverwrite(Boolean(value))}
                  />
                  {t("overwriteConfirm")}
                </label>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={pending || (isOverwrite && !confirmOverwrite)}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isOverwrite ? t("saveOverwrite") : t("saveNew")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
