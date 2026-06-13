"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  createLevelAction,
  updateLevelAction,
  deleteLevelAction,
} from "@/lib/actions/levels";
import type { Level } from "@/lib/types";

type Props = {
  levels: Level[];
  clubId: string;
  isCustomized: boolean;
};

// ─── Inline edit row ──────────────────────────────────────────────────────────

function EditRow({
  level,
  clubId,
  onDone,
}: {
  level: Level;
  clubId: string;
  onDone: () => void;
}) {
  const t = useTranslations("club.levelsManager");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [real, setReal] = useState(String(level.real));
  const [label, setLabel] = useState(level.label);

  function handleSave() {
    const realNum = parseFloat(real);
    if (!Number.isFinite(realNum)) {
      toast.error(t("validationReal"));
      return;
    }
    if (!label.trim()) {
      toast.error(t("validationLabel"));
      return;
    }
    start(async () => {
      const res = await updateLevelAction({ clubId, id: level.id, real: realNum, label: label.trim() });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <Input
        type="number"
        step="0.5"
        min={0}
        max={100}
        value={real}
        onChange={(e) => setReal(e.target.value)}
        className="h-7 w-20 text-sm"
        aria-label="real value"
      />
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-7 flex-1 text-sm"
        aria-label="label"
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onDone();
        }}
      />
      <Tooltip>
        <TooltipTrigger render={
          <Button size="xs" disabled={pending} onClick={handleSave}>
            <Check className="h-3.5 w-3.5" />
          </Button>
        } />
        <TooltipContent>{t("saveTooltip")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={
          <Button size="xs" variant="ghost" disabled={pending} onClick={onDone}>
            <X className="h-3.5 w-3.5" />
          </Button>
        } />
        <TooltipContent>{t("cancelTooltip")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Level row (read mode) ────────────────────────────────────────────────────

function LevelRow({ level, clubId }: { level: Level; clubId: string }) {
  const t = useTranslations("club.levelsManager");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  if (editing) {
    return <EditRow level={level} clubId={clubId} onDone={() => setEditing(false)} />;
  }

  function handleDelete() {
    start(async () => {
      const res = await deleteLevelAction({ clubId, id: level.id });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        router.refresh();
      }
      setConfirmDelete(false);
    });
  }

  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="font-medium w-8 tabular-nums text-right">{level.real}</span>
      <span className="flex-1">{level.label}</span>

      {confirmDelete ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-destructive">{t("confirmDelete")}</span>
          <Button
            size="xs"
            variant="destructive"
            disabled={pending}
            onClick={handleDelete}
          >
            {t("confirmButton")}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirmDelete(false)}
          >
            {t("cancelButton")}
          </Button>
        </div>
      ) : (
        <>
          <Tooltip>
            <TooltipTrigger render={
              <Button
                size="xs"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            } />
            <TooltipContent>{t("editTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={
              <Button
                size="xs"
                variant="ghost"
                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            } />
            <TooltipContent>{t("deleteTooltip")}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

// ─── Add row ──────────────────────────────────────────────────────────────────

function AddRow({ clubId }: { clubId: string }) {
  const t = useTranslations("club.levelsManager");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [real, setReal] = useState("");
  const [label, setLabel] = useState("");

  function handleAdd() {
    const realNum = parseFloat(real);
    if (!Number.isFinite(realNum)) {
      toast.error(t("validationReal"));
      return;
    }
    if (!label.trim()) {
      toast.error(t("validationLabel"));
      return;
    }
    start(async () => {
      const res = await createLevelAction({ clubId, real: realNum, label: label.trim() });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        setReal("");
        setLabel("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-2 pt-3 border-t mt-2">
      <Input
        type="number"
        step="0.5"
        min={0}
        max={100}
        value={real}
        onChange={(e) => setReal(e.target.value)}
        placeholder="real"
        className="h-7 w-20 text-sm"
        aria-label={t("realAddAriaLabel")}
      />
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("addPlaceholder")}
        className="h-7 flex-1 text-sm"
        aria-label={t("labelAddAriaLabel")}
        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
      />
      <Tooltip>
        <TooltipTrigger render={
          <Button size="xs" disabled={pending} onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("addButton")}
          </Button>
        } />
        <TooltipContent>{t("addTooltip")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ClubLevelsManager({ levels, clubId, isCustomized }: Props) {
  const t = useTranslations("club.levelsManager");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t("title")}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("description")}
        </p>
        <p className="text-xs text-muted-foreground">
          {isCustomized ? t("usingClubSet") : t("usingGlobalDefault")}
        </p>
      </CardHeader>
      <CardContent className="space-y-0.5">
        {levels.length === 0 && (
          <p className="text-sm text-muted-foreground py-1">{t("empty")}</p>
        )}
        {levels.map((l) => (
          <LevelRow key={l.id} level={l} clubId={clubId} />
        ))}
        <AddRow clubId={clubId} />
        <p className="text-[11px] text-muted-foreground pt-1">
          {t("deleteWarning")}
        </p>
      </CardContent>
    </Card>
  );
}
