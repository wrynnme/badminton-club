"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Check, Link2, Loader2, Pencil, RotateCcw, Trash2, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  addSeriesMemberAction,
  removeSeriesMemberAction,
  resetSeriesMemberLevelsAction,
  updateSeriesMemberAction,
} from "@/lib/actions/club-series";
import { NONE_SENTINEL, levelTriggerLabel } from "@/lib/club/levels-ui";
import type { Level, SeriesMember } from "@/lib/types";

// ─── Member row ────────────────────────────────────────────────────────────

function MemberRow({
  seriesId,
  member,
  levels,
}: {
  seriesId: string;
  member: SeriesMember;
  levels: Level[];
}) {
  const t = useTranslations("club.seriesMembers");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(member.canonical_name);
  const [pendingName, startName] = useTransition();
  const [pendingLevel, startLevel] = useTransition();
  const [pendingRegular, startRegular] = useTransition();
  const [removeOpen, setRemoveOpen] = useState(false);

  function startEdit() {
    setNameValue(member.canonical_name);
    setEditing(true);
  }

  function saveName() {
    const trimmed = nameValue.trim();
    if (!trimmed) return;
    if (trimmed === member.canonical_name) {
      setEditing(false);
      return;
    }
    startName(async () => {
      const res = await updateSeriesMemberAction({
        seriesId,
        memberId: member.id,
        patch: { canonicalName: trimmed },
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("renameSuccess"));
      setEditing(false);
      router.refresh();
    });
  }

  function handleLevelChange(v: string) {
    startLevel(async () => {
      const res = await updateSeriesMemberAction({
        seriesId,
        memberId: member.id,
        patch: { defaultLevelId: v === NONE_SENTINEL ? null : v },
      });
      if ("error" in res) toast.error(res.error);
      else router.refresh();
    });
  }

  function handleRegularToggle(checked: boolean) {
    startRegular(async () => {
      const res = await updateSeriesMemberAction({
        seriesId,
        memberId: member.id,
        patch: { isRegular: checked },
      });
      if ("error" in res) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-2 border rounded px-3 py-2 text-sm">
      {editing ? (
        <div className="flex items-center gap-1 flex-1 min-w-[140px]">
          <Input
            autoFocus
            value={nameValue}
            maxLength={60}
            onChange={(e) => setNameValue(e.target.value)}
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <Tooltip>
            <TooltipTrigger render={<Button size="xs" disabled={pendingName} onClick={saveName}><Check className="h-3.5 w-3.5" /></Button>} />
            <TooltipContent>{t("saveTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button size="xs" variant="ghost" disabled={pendingName} onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" /></Button>} />
            <TooltipContent>{t("cancelTooltip")}</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <>
          <span className="font-medium flex-1 min-w-[100px] truncate">{member.canonical_name}</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button size="xs" variant="ghost" className="h-6 w-6 p-0" onClick={startEdit} aria-label={t("renameTooltip")}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>{t("renameTooltip")}</TooltipContent>
          </Tooltip>
        </>
      )}

      <Badge variant={member.profile_id ? "secondary" : "outline"} className="gap-1 shrink-0">
        {member.profile_id ? (
          <>
            <Link2 className="h-3 w-3" />
            {t("lineLinkedBadge")}
          </>
        ) : (
          t("nameOnlyBadge")
        )}
      </Badge>

      <Select
        value={member.default_level_id ?? NONE_SENTINEL}
        onValueChange={(v) => { if (v) handleLevelChange(v); }}
        disabled={pendingLevel}
      >
        <SelectTrigger size="sm" className="h-8 w-28 text-xs shrink-0">
          <SelectValue>{(v: string) => levelTriggerLabel(levels, v === NONE_SENTINEL ? null : v, t("levelNone"))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_SENTINEL}>{t("levelNone")}</SelectItem>
          {levels.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.label} ({l.real})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5 shrink-0">
        <Checkbox
          checked={member.is_regular}
          onCheckedChange={(v) => handleRegularToggle(!!v)}
          disabled={pendingRegular}
          id={`series-member-regular-${member.id}`}
        />
        <label htmlFor={`series-member-regular-${member.id}`} className="text-xs cursor-pointer select-none">
          {t("regularLabel")}
        </label>
      </div>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="ghost"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive shrink-0"
              onClick={() => setRemoveOpen(true)}
              aria-label={t("removeTooltip")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <TooltipContent>{t("removeTooltip")}</TooltipContent>
      </Tooltip>

      <RemoveMemberDialog open={removeOpen} onOpenChange={setRemoveOpen} seriesId={seriesId} member={member} />
    </li>
  );
}

// ─── Remove confirm dialog ─────────────────────────────────────────────────

function RemoveMemberDialog({
  open,
  onOpenChange,
  seriesId,
  member,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  seriesId: string;
  member: SeriesMember;
}) {
  const t = useTranslations("club.seriesMembers");
  const router = useRouter();
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      const res = await removeSeriesMemberAction({ seriesId, memberId: member.id });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("removeSuccess"));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            {t("removeConfirmTitle")}
          </DialogTitle>
          <DialogDescription>{t("removeConfirmDesc", { name: member.canonical_name })}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("removeConfirmNote")}</p>
        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="outline" disabled={pending}>{t("removeCancel")}</Button>} />
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                {t("removing")}
              </>
            ) : (
              t("removeConfirm")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add member dialog ─────────────────────────────────────────────────────

function AddMemberButton({ seriesId, levels }: { seriesId: string; levels: Level[] }) {
  const t = useTranslations("club.seriesMembers");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [levelId, setLevelId] = useState(NONE_SENTINEL);
  const [isRegular, setIsRegular] = useState(true);
  const [pending, start] = useTransition();

  function reset() {
    setName("");
    setLevelId(NONE_SENTINEL);
    setIsRegular(true);
  }

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("validationName"));
      return;
    }
    start(async () => {
      const res = await addSeriesMemberAction({
        seriesId,
        name: trimmed,
        levelId: levelId === NONE_SENTINEL ? null : levelId,
        isRegular,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("addSuccess"));
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <UserPlus className="h-4 w-4 mr-1" />
              {t("addButton")}
            </Button>
          }
        />
        <TooltipContent>{t("addTooltip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("addDialogTitle")}</DialogTitle>
            <DialogDescription className="text-xs">{t("addDialogDesc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">{t("nameLabel")}</Label>
              <Input
                autoFocus
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-sm"
                placeholder={t("namePlaceholder")}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("levelLabel")}</Label>
              <Select value={levelId} onValueChange={(v) => { if (v) setLevelId(v); }}>
                <SelectTrigger className="h-8 w-full text-sm">
                  <SelectValue>{(v: string) => levelTriggerLabel(levels, v === NONE_SENTINEL ? null : v, t("levelNone"))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_SENTINEL}>{t("levelNone")}</SelectItem>
                  {levels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label} ({l.real})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox checked={isRegular} onCheckedChange={(v) => setIsRegular(!!v)} id="series-add-member-regular" />
              <Label htmlFor="series-add-member-regular" className="text-xs font-normal cursor-pointer">
                {t("regularCheckboxLabel")}
              </Label>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose render={<Button variant="outline" disabled={pending}>{t("addCancel")}</Button>} />
            <Button onClick={handleSubmit} disabled={pending || !name.trim()}>
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  {t("adding")}
                </>
              ) : (
                t("addConfirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Reset all levels ───────────────────────────────────────────────────────

function ResetLevelsButton({ seriesId }: { seriesId: string }) {
  const t = useTranslations("club.seriesMembers");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      const res = await resetSeriesMemberLevelsAction({ seriesId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("resetLevelsSuccess", { count: res.count }));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-1" />
              {t("resetLevelsButton")}
            </Button>
          }
        />
        <TooltipContent>{t("resetLevelsTooltip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              {t("resetLevelsConfirmTitle")}
            </DialogTitle>
            <DialogDescription>{t("resetLevelsConfirmDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose render={<Button variant="outline" disabled={pending}>{t("resetLevelsCancel")}</Button>} />
            <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  {t("resetting")}
                </>
              ) : (
                t("resetLevelsConfirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function SeriesMembersManager({
  seriesId,
  members,
  levels,
}: {
  seriesId: string;
  members: SeriesMember[];
  levels: Level[];
}) {
  const t = useTranslations("club.seriesMembers");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          {t("heading")}
          <Badge variant="secondary">{members.length}</Badge>
        </CardTitle>
        <div className="flex items-center gap-2">
          <ResetLevelsButton seriesId={seriesId} />
          <AddMemberButton seriesId={seriesId} levels={levels} />
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t("empty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((m) => (
              <MemberRow key={m.id} seriesId={seriesId} member={m} levels={levels} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
