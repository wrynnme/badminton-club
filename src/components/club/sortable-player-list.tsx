"use client";

import { useState, useTransition, useId, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
// Progress-bar-aware router for user mutations; the plain one stays for the
// 30s auto-refresh interval so the top bar doesn't flash on every tick.
import { useRouter as useProgressRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import {
  RefreshCw, GripVertical, CheckCircle2, Circle, Loader2, Clock,
  CheckCheck, Users, Trash2, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pencil, Gauge } from "lucide-react";
import { LeaveButton } from "@/components/club/leave-button";
import { KickButton } from "@/components/club/kick-button";
import {
  reorderPlayersAction,
  toggleCheckInAction,
  updateClubPlayerSessionAction,
  updateClubPlayerDetailsAction,
  bulkSetClubPlayerLevelAction,
  promoteClubReserveAction,
  bulkCheckInClubPlayersAction,
  bulkSetClubPlayerStatusAction,
  bulkUpdateClubPlayerSessionAction,
  bulkDeleteClubPlayersAction,
} from "@/lib/actions/club-players";
import type { ClubPlayer, Level } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  clubId: string;
  players: ClubPlayer[];
  sessionProfileId: string | null;
  canManage: boolean;
  levels?: Level[];
  /** Club session window — used as placeholder for player time inputs. */
  sessionStart?: string; // "HH:MM:SS"
  sessionEnd?: string;   // "HH:MM:SS"
};

// Radix/Base UI Select can't hold an empty-string value; this sentinel stands in
// for "ไม่มีระดับ" (no level) and is mapped to null at the action boundary.
const NONE_SENTINEL = "__none__";

/** Trigger label for a selected level value. Base UI's SelectValue does not echo
 * the chosen SelectItem's text, so callers pass this as its render child. */
function levelTriggerLabel(levels: Level[] | undefined, v: string, noneLabel: string) {
  if (!v || v === NONE_SENTINEL) return noneLabel;
  return levels?.find((l) => l.id === v)?.label ?? noneLabel;
}

// ─── Check-in button ─────────────────────────────────────────────────────────

function CheckInButton({
  player,
  clubId,
  canToggle,
}: {
  player: ClubPlayer;
  clubId: string;
  canToggle: boolean;
}) {
  const t = useTranslations("club.playerList");
  const router = useProgressRouter();
  const [pending, start] = useTransition();
  const isCheckedIn = !!player.checked_in_at;

  if (!canToggle) {
    return isCheckedIn ? (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t("checkInReady")}
      </span>
    ) : null;
  }

  return (
    <Button
      size="xs"
      variant={isCheckedIn ? "secondary" : "outline"}
      className={isCheckedIn ? "text-green-600 dark:text-green-400 border-green-500/40 bg-green-500/10 hover:bg-green-500/20" : ""}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await toggleCheckInAction({ club_id: clubId, player_id: player.id });
          if (res && "error" in res) toast.error(res.error);
          else router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isCheckedIn ? (
        <>
          <CheckCircle2 className="h-3 w-3" />
          {t("checkInReady")}
        </>
      ) : (
        <>
          <Circle className="h-3 w-3" />
          {t("checkInButton")}
        </>
      )}
    </Button>
  );
}

// ─── Session editor (inline, canManage only) ──────────────────────────────────

function SessionEditor({
  player,
  clubId,
  sessionStart,
  sessionEnd,
}: {
  player: ClubPlayer;
  clubId: string;
  sessionStart?: string;
  sessionEnd?: string;
}) {
  const t = useTranslations("club.playerList");
  const router = useProgressRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const clubStartPlaceholder = sessionStart?.slice(0, 5) ?? "";
  const clubEndPlaceholder = sessionEnd?.slice(0, 5) ?? "";

  // Pre-fill with the player's override, else the club's full window (not blank).
  const [startVal, setStartVal] = useState(player.start_time?.slice(0, 5) ?? clubStartPlaceholder);
  const [endVal, setEndVal] = useState(player.end_time?.slice(0, 5) ?? clubEndPlaceholder);
  const [games, setGames] = useState(player.games_played);

  // Resync from parent when the editor is CLOSED. While open, a background
  // router.refresh() (30s auto-refresh) must not clobber the admin's in-progress edit.
  useEffect(() => {
    if (open) return;
    setStartVal(player.start_time?.slice(0, 5) ?? clubStartPlaceholder);
    setEndVal(player.end_time?.slice(0, 5) ?? clubEndPlaceholder);
    setGames(player.games_played);
  }, [open, player.start_time, player.end_time, player.games_played, clubStartPlaceholder, clubEndPlaceholder]);

  function handleSave() {
    start(async () => {
      const res = await updateClubPlayerSessionAction(clubId, player.id, {
        // A value equal to the club window means "no override" → store null so the
        // partial-session label only shows when the player truly differs.
        start_time: startVal && startVal !== clubStartPlaceholder ? startVal : null,
        end_time: endVal && endVal !== clubEndPlaceholder ? endVal : null,
        games_played: games,
      });
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("sessionEditorSaved"));
        router.refresh();
        setOpen(false);
      }
    });
  }

  if (!open) {
    // Show a subtle summary when anything non-default is set
    const hasOverride = player.start_time || player.end_time || player.games_played > 0;
    return (
      <Button
        size="xs"
        variant="ghost"
        className="text-muted-foreground h-6 px-1.5 text-xs"
        onClick={() => setOpen(true)}
        title={t("sessionEditorTitle")}
      >
        <Clock className="h-3 w-3" />
        {hasOverride ? (
          <span className="ml-0.5 tabular-nums">
            {player.games_played > 0 ? `${player.games_played}g` : ""}
            {player.start_time || player.end_time ? " ⏱" : ""}
          </span>
        ) : null}
      </Button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2 text-xs">
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px] text-muted-foreground">{t("sessionEditorStart")}</Label>
        <Input
          type="time"
          value={startVal}
          placeholder={clubStartPlaceholder}
          onChange={(e) => setStartVal(e.target.value)}
          className="h-7 w-[100px] text-xs"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px] text-muted-foreground">{t("sessionEditorEnd")}</Label>
        <Input
          type="time"
          value={endVal}
          placeholder={clubEndPlaceholder}
          onChange={(e) => setEndVal(e.target.value)}
          className="h-7 w-[100px] text-xs"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px] text-muted-foreground">{t("sessionEditorGames")}</Label>
        <Input
          type="number"
          min={0}
          max={500}
          value={games}
          onChange={(e) => setGames(Math.max(0, parseInt(e.target.value, 10) || 0))}
          className="h-7 w-[64px] text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>
      <div className="flex items-end gap-1 pb-0.5">
        <Button
          type="button"
          size="xs"
          disabled={pending}
          onClick={handleSave}
          className="h-7 text-xs"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : t("sessionEditorSave")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setOpen(false)}
        >
          {t("sessionEditorCancel")}
        </Button>
      </div>
      {(clubStartPlaceholder || clubEndPlaceholder) && (
        <p className="w-full text-[10px] text-muted-foreground">
          {t("sessionEditorClubWindow", { start: clubStartPlaceholder, end: clubEndPlaceholder })}
        </p>
      )}
    </div>
  );
}

// ─── Edit control (canManage only) ────────────────────────────────────────────

function EditButton({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations("club.playerList");
  return (
    <Button
      size="xs"
      variant="ghost"
      className="text-muted-foreground h-6 w-6 p-0"
      onClick={onOpen}
      title={t("editTitle")}
      type="button"
    >
      <Pencil className="h-3 w-3" />
    </Button>
  );
}

/**
 * Inline quick level picker shown in the row for managers (non-managers see a
 * static Badge instead). Saves on change; reverts on error. Resyncs from props
 * only while closed + idle so a background refresh can't clobber an edit.
 */
function LevelQuickSelect({
  player,
  clubId,
  levels,
}: {
  player: ClubPlayer;
  clubId: string;
  levels?: Level[];
}) {
  const t = useTranslations("club.playerList");
  const router = useProgressRouter();
  const [value, setValue] = useState(player.level_id ?? NONE_SENTINEL);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open || pending) return;
    setValue(player.level_id ?? NONE_SENTINEL);
  }, [open, pending, player.level_id]);

  function handleChange(next: string) {
    const prev = value;
    setValue(next); // optimistic
    start(async () => {
      const res = await updateClubPlayerDetailsAction({
        club_id: clubId,
        player_id: player.id,
        level_id: next === NONE_SENTINEL ? null : next,
      });
      if (res && "error" in res) {
        toast.error(res.error);
        setValue(prev); // revert
      } else {
        toast.success(t("levelSaved"));
        router.refresh();
      }
    });
  }

  return (
    <Select
      value={value}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(v) => {
        if (v) handleChange(v);
      }}
      disabled={pending}
    >
      <SelectTrigger
        size="sm"
        className="h-6 w-auto max-w-[96px] gap-1 px-2 text-xs"
        aria-label={t("levelSelectAriaLabel", { name: player.display_name })}
      >
        <SelectValue>{(v: string) => levelTriggerLabel(levels, v, t("levelNone"))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_SENTINEL}>{t("levelNone")}</SelectItem>
        {(levels ?? []).map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.label} ({l.real})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Inline "edit player" form (expands below the row). Name is guest-only; level
 * and note apply to every player. One partial-patch call. */
function EditPlayerForm({
  player,
  clubId,
  levels,
  onClose,
}: {
  player: ClubPlayer;
  clubId: string;
  levels?: Level[];
  onClose: () => void;
}) {
  const t = useTranslations("club.playerList");
  const router = useProgressRouter();
  const isGuest = player.profile_id == null;
  const [name, setName] = useState(player.display_name);
  const [level, setLevel] = useState(player.level_id ?? NONE_SENTINEL);
  const [note, setNote] = useState(player.note ?? "");
  const [pending, start] = useTransition();

  function handleSave() {
    const trimmedName = name.trim();
    if (isGuest && !trimmedName) return;
    start(async () => {
      const res = await updateClubPlayerDetailsAction({
        club_id: clubId,
        player_id: player.id,
        ...(isGuest ? { display_name: trimmedName } : {}),
        level_id: level === NONE_SENTINEL ? null : level,
        note: note.trim() || null,
      });
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("editSaved"));
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <div className="mt-1.5 flex flex-col gap-2 rounded-md border bg-muted/30 p-2 text-xs">
      {isGuest && (
        <div className="flex flex-col gap-0.5">
          <Label className="text-[10px] text-muted-foreground">{t("renameLabel")}</Label>
          <Input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
            className="h-7 text-xs"
          />
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px] text-muted-foreground">{t("editLevelLabel")}</Label>
        <Select value={level} onValueChange={(v) => { if (v) setLevel(v); }}>
          <SelectTrigger size="sm" className="h-7 w-full text-xs">
            <SelectValue>{(v: string) => levelTriggerLabel(levels, v, t("levelNone"))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_SENTINEL}>{t("levelNone")}</SelectItem>
            {(levels ?? []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label} ({l.real})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px] text-muted-foreground">{t("editNoteLabel")}</Label>
        <Textarea
          value={note}
          maxLength={500}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          className="text-xs"
        />
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="xs"
          disabled={pending || (isGuest && !name.trim())}
          onClick={handleSave}
          className="h-7 text-xs"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : t("renameSave")}
        </Button>
        <Button type="button" size="xs" variant="ghost" className="h-7 text-xs" onClick={onClose}>
          {t("renameCancel")}
        </Button>
      </div>
    </div>
  );
}

// ─── Bulk session dialog ──────────────────────────────────────────────────────

function BulkSessionDialog({
  open,
  onOpenChange,
  clubId,
  playerIds,
  sessionStart,
  sessionEnd,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clubId: string;
  playerIds: string[];
  sessionStart?: string;
  sessionEnd?: string;
  onDone: () => void;
}) {
  const t = useTranslations("club.bulkSelect");
  const router = useProgressRouter();
  const [pending, start] = useTransition();

  const clubStartPlaceholder = sessionStart?.slice(0, 5) ?? "";
  const clubEndPlaceholder = sessionEnd?.slice(0, 5) ?? "";

  const [enableStart, setEnableStart] = useState(false);
  const [startVal, setStartVal] = useState("");
  const [enableEnd, setEnableEnd] = useState(false);
  const [endVal, setEndVal] = useState("");
  const [enableGames, setEnableGames] = useState(false);
  const [games, setGames] = useState(0);

  // Reset fields each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setEnableStart(false); setStartVal("");
    setEnableEnd(false); setEndVal("");
    setEnableGames(false); setGames(0);
  }, [open]);

  const noneEnabled = !enableStart && !enableEnd && !enableGames;

  function handleSubmit() {
    start(async () => {
      const payload: {
        clubId: string;
        playerIds: string[];
        start_time?: string;
        end_time?: string;
        games_played?: number;
      } = { clubId, playerIds };
      if (enableStart) payload.start_time = startVal;
      if (enableEnd) payload.end_time = endVal;
      if (enableGames) payload.games_played = games;

      const res = await bulkUpdateClubPlayerSessionAction(payload);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("toastSession", { count: res.count }));
        router.refresh();
        onOpenChange(false);
        onDone();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("sessionDialogTitle")}</DialogTitle>
          <DialogDescription className="text-xs">{t("sessionDialogNote")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 text-sm">
          {/* Start time */}
          <div className="flex items-center gap-3">
            <Checkbox
              checked={enableStart}
              onCheckedChange={(v) => setEnableStart(!!v)}
              id="bulk-start-enable"
            />
            <label htmlFor="bulk-start-enable" className="flex-1 cursor-pointer font-medium">
              {t("sessionFieldStart")}
            </label>
            <Input
              type="time"
              value={startVal}
              placeholder={clubStartPlaceholder}
              disabled={!enableStart}
              onChange={(e) => setStartVal(e.target.value)}
              className="h-8 w-[110px] text-xs"
            />
          </div>

          {/* End time */}
          <div className="flex items-center gap-3">
            <Checkbox
              checked={enableEnd}
              onCheckedChange={(v) => setEnableEnd(!!v)}
              id="bulk-end-enable"
            />
            <label htmlFor="bulk-end-enable" className="flex-1 cursor-pointer font-medium">
              {t("sessionFieldEnd")}
            </label>
            <Input
              type="time"
              value={endVal}
              placeholder={clubEndPlaceholder}
              disabled={!enableEnd}
              onChange={(e) => setEndVal(e.target.value)}
              className="h-8 w-[110px] text-xs"
            />
          </div>

          {/* Games */}
          <div className="flex items-center gap-3">
            <Checkbox
              checked={enableGames}
              onCheckedChange={(v) => setEnableGames(!!v)}
              id="bulk-games-enable"
            />
            <label htmlFor="bulk-games-enable" className="flex-1 cursor-pointer font-medium">
              {t("sessionFieldGames")}
            </label>
            <Input
              type="number"
              min={0}
              max={500}
              value={games}
              disabled={!enableGames}
              onChange={(e) => setGames(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="h-8 w-[80px] text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={
            <Button variant="outline" disabled={pending}>{t("sessionDialogCancel")}</Button>
          } />
          <Button onClick={handleSubmit} disabled={pending || noneEnabled}>
            {pending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />{t("sessionDialogSubmitting")}</>
              : t("sessionDialogSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk level dialog ────────────────────────────────────────────────────────

function BulkLevelDialog({
  open,
  onOpenChange,
  clubId,
  playerIds,
  levels,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clubId: string;
  playerIds: string[];
  levels?: Level[];
  onDone: () => void;
}) {
  const t = useTranslations("club.bulkSelect");
  const tp = useTranslations("club.playerList");
  const router = useProgressRouter();
  const [pending, start] = useTransition();
  const [level, setLevel] = useState(NONE_SENTINEL);

  useEffect(() => {
    if (open) setLevel(NONE_SENTINEL);
  }, [open]);

  function handleSubmit() {
    start(async () => {
      const res = await bulkSetClubPlayerLevelAction({
        clubId,
        playerIds,
        levelId: level === NONE_SENTINEL ? null : level,
      });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("toastLevel", { count: res.count }));
        router.refresh();
        onOpenChange(false);
        onDone();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("levelDialogTitle", { n: playerIds.length })}</DialogTitle>
          <DialogDescription className="text-xs">{t("levelDialogNote")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-1">
          <Label className="text-xs">{t("levelFieldLabel")}</Label>
          <Select value={level} onValueChange={(v) => { if (v) setLevel(v); }}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => levelTriggerLabel(levels, v, t("levelNone"))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_SENTINEL}>{t("levelNone")}</SelectItem>
              {(levels ?? []).map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.label} ({l.real})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={
            <Button variant="outline" disabled={pending}>{t("levelDialogCancel")}</Button>
          } />
          <Button onClick={handleSubmit} disabled={pending}>
            {pending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />{t("levelDialogSubmitting")}</>
              : t("levelDialogSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk delete dialog ───────────────────────────────────────────────────────

function BulkDeleteDialog({
  open,
  onOpenChange,
  clubId,
  players,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clubId: string;
  players: ClubPlayer[];
  onDone: () => void;
}) {
  const t = useTranslations("club.bulkSelect");
  const router = useProgressRouter();
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      const res = await bulkDeleteClubPlayersAction({
        clubId,
        playerIds: players.map((p) => p.id),
      });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        if (res.failed > 0) {
          toast.error(t("toastDeletePartial", { deleted: res.deleted, failed: res.failed }));
        } else {
          toast.success(t("toastDeleted", { count: res.deleted }));
        }
        router.refresh();
        onOpenChange(false);
        onDone();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            {t("deleteDialogTitle", { n: players.length })}
          </DialogTitle>
          <DialogDescription>{t("deleteDialogDesc")}</DialogDescription>
        </DialogHeader>

        {/* Scrollable name list */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm max-h-36 overflow-y-auto">
          <p className="text-xs text-muted-foreground mb-1">{t("deleteListLabel")}</p>
          <ul className="space-y-0.5">
            {players.map((p) => (
              <li key={p.id} className="truncate">{p.display_name}</li>
            ))}
          </ul>
        </div>

        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>
            {t("deleteBullet1")}
            <span className="text-foreground font-medium ml-1">{t("deleteBullet1Emph")}</span>
          </li>
          <li>{t("deleteBullet2")}</li>
          <li>{t("deleteBullet3")}</li>
        </ul>
        <p className="text-sm font-medium text-destructive">{t("deletePermanent")}</p>

        <DialogFooter className="gap-2">
          <DialogClose render={
            <Button variant="outline" disabled={pending}>{t("deleteCancel")}</Button>
          } />
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />{t("deleteDeleting")}</>
              : t("deleteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────

function BulkActionBar({
  clubId,
  selectedIds,
  allPlayers,
  levels,
  sessionStart,
  sessionEnd,
  onClearSelection,
}: {
  clubId: string;
  selectedIds: Set<string>;
  allPlayers: ClubPlayer[];
  levels?: Level[];
  sessionStart?: string;
  sessionEnd?: string;
  onClearSelection: () => void;
}) {
  const t = useTranslations("club.bulkSelect");
  const router = useProgressRouter();
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [levelDialogOpen, setLevelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pending, start] = useTransition();

  const selectedPlayers = allPlayers.filter((p) => selectedIds.has(p.id));
  const playerIds = selectedPlayers.map((p) => p.id);
  const n = selectedIds.size;

  if (n === 0) return null;

  function runBulkCheckIn(checkIn: boolean) {
    start(async () => {
      const res = await bulkCheckInClubPlayersAction({ clubId, playerIds, checkIn });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(
          checkIn
            ? t("toastCheckIn", { count: res.count })
            : t("toastUndoCheckIn", { count: res.count })
        );
        router.refresh();
        onClearSelection();
      }
    });
  }

  function runBulkStatus(status: "active" | "reserve") {
    start(async () => {
      const res = await bulkSetClubPlayerStatusAction({ clubId, playerIds, status });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(
          status === "active"
            ? t("toastSetActive", { count: res.count })
            : t("toastSetReserve", { count: res.count })
        );
        router.refresh();
        onClearSelection();
      }
    });
  }

  return (
    <>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border bg-background/95 backdrop-blur px-3 py-2 shadow-md text-sm">
        <span className="font-medium text-xs mr-1 shrink-0">
          {t("selectedCount", { n })}
        </span>

        {/* Check in */}
        <Tooltip>
          <TooltipTrigger render={
            <Button size="xs" variant="outline" disabled={pending} onClick={() => runBulkCheckIn(true)}
              aria-label={t("checkInTooltip")}>
              <CheckCheck className="h-3.5 w-3.5" />
              <span className="hidden sm:inline ml-1">{t("checkIn")}</span>
            </Button>
          } />
          <TooltipContent>{t("checkInTooltip")}</TooltipContent>
        </Tooltip>

        {/* Undo check-in */}
        <Tooltip>
          <TooltipTrigger render={
            <Button size="xs" variant="outline" disabled={pending} onClick={() => runBulkCheckIn(false)}
              aria-label={t("undoCheckInTooltip")}>
              <Circle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline ml-1">{t("undoCheckIn")}</span>
            </Button>
          } />
          <TooltipContent>{t("undoCheckInTooltip")}</TooltipContent>
        </Tooltip>

        {/* Set active */}
        <Tooltip>
          <TooltipTrigger render={
            <Button size="xs" variant="outline" disabled={pending} onClick={() => runBulkStatus("active")}
              aria-label={t("setActiveTooltip")}>
              <Users className="h-3.5 w-3.5" />
              <span className="hidden sm:inline ml-1">{t("setActive")}</span>
            </Button>
          } />
          <TooltipContent>{t("setActiveTooltip")}</TooltipContent>
        </Tooltip>

        {/* Set reserve */}
        <Tooltip>
          <TooltipTrigger render={
            <Button size="xs" variant="outline" disabled={pending} onClick={() => runBulkStatus("reserve")}
              aria-label={t("setReserveTooltip")}>
              <span className="hidden sm:inline">{t("setReserve")}</span>
              <span className="sm:hidden">{t("setReserve")}</span>
            </Button>
          } />
          <TooltipContent>{t("setReserveTooltip")}</TooltipContent>
        </Tooltip>

        {/* Edit session */}
        <Tooltip>
          <TooltipTrigger render={
            <Button size="xs" variant="outline" disabled={pending}
              onClick={() => setSessionDialogOpen(true)}
              aria-label={t("editSessionTooltip")}>
              <Clock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline ml-1">{t("editSession")}</span>
            </Button>
          } />
          <TooltipContent>{t("editSessionTooltip")}</TooltipContent>
        </Tooltip>

        {/* Set level */}
        <Tooltip>
          <TooltipTrigger render={
            <Button size="xs" variant="outline" disabled={pending}
              onClick={() => setLevelDialogOpen(true)}
              aria-label={t("setLevelTooltip")}>
              <Gauge className="h-3.5 w-3.5" />
              <span className="hidden sm:inline ml-1">{t("setLevel")}</span>
            </Button>
          } />
          <TooltipContent>{t("setLevelTooltip")}</TooltipContent>
        </Tooltip>

        {/* Delete */}
        <Tooltip>
          <TooltipTrigger render={
            <Button size="xs" variant="destructive" disabled={pending}
              onClick={() => setDeleteDialogOpen(true)}
              aria-label={t("deleteTooltip")}>
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline ml-1">{t("delete")}</span>
            </Button>
          } />
          <TooltipContent>{t("deleteTooltip")}</TooltipContent>
        </Tooltip>
      </div>

      <BulkSessionDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        clubId={clubId}
        playerIds={playerIds}
        sessionStart={sessionStart}
        sessionEnd={sessionEnd}
        onDone={onClearSelection}
      />

      <BulkLevelDialog
        open={levelDialogOpen}
        onOpenChange={setLevelDialogOpen}
        clubId={clubId}
        playerIds={playerIds}
        levels={levels}
        onDone={onClearSelection}
      />

      <BulkDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        clubId={clubId}
        players={selectedPlayers}
        onDone={onClearSelection}
      />
    </>
  );
}

// ─── Shared row body (presentational — no useSortable) ───────────────────────
// Used by both SortableItem (active, draggable) and ReserveItem (static).

type RowBodyProps = {
  player: ClubPlayer;
  clubId: string;
  sessionProfileId: string | null;
  canManage: boolean;
  sessionStart?: string;
  sessionEnd?: string;
  levels?: Level[];
  /** Drag handle element injected by SortableItem; null for reserve rows. */
  dragHandle?: React.ReactNode;
  /** Position label shown before the name (e.g. "1." or "#1"). */
  positionLabel: React.ReactNode;
  /** Select-mode checkbox — provided when selectMode is on */
  selectCheckbox?: React.ReactNode;
};

function PlayerRowBody({
  player,
  clubId,
  sessionProfileId,
  canManage,
  sessionStart,
  sessionEnd,
  levels,
  dragHandle,
  positionLabel,
  selectCheckbox,
}: RowBodyProps) {
  const t = useTranslations("club.playerList");
  const isCheckedIn = !!player.checked_in_at;
  // Require a non-null session: a public/anon viewer has sessionProfileId=null and
  // guest players have profile_id=null, so a bare `===` would render the self-only
  // LeaveButton on every guest row for anonymous viewers.
  const isSelf = sessionProfileId != null && sessionProfileId === player.profile_id;
  const [editOpen, setEditOpen] = useState(false);

  // Partial session: player's effective window differs from the club's full window.
  const cs = sessionStart?.slice(0, 5);
  const ce = sessionEnd?.slice(0, 5);
  const effStart = player.start_time?.slice(0, 5) ?? cs;
  const effEnd = player.end_time?.slice(0, 5) ?? ce;
  const isPartial = !!(cs && ce) && (effStart !== cs || effEnd !== ce);

  return (
    <>
      {/* Main row */}
      <div className="flex items-center gap-2">
        {selectCheckbox}
        {dragHandle}
        <span className="text-muted-foreground w-6 tabular-nums">{positionLabel}</span>
        <span className="font-medium">{player.display_name}</span>
        {canManage && <EditButton onOpen={() => setEditOpen(true)} />}
        {canManage ? (
          <LevelQuickSelect player={player} clubId={clubId} levels={levels} />
        ) : (
          (() => {
            const label = player.level_id ? levels?.find((l) => l.id === player.level_id)?.label : undefined;
            return label ? <Badge variant="outline">{label}</Badge> : null;
          })()
        )}
        {player.note && (
          <span className="text-muted-foreground text-xs hidden sm:inline">— {player.note}</span>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          {canManage && (
            <SessionEditor
              player={player}
              clubId={clubId}
              sessionStart={sessionStart}
              sessionEnd={sessionEnd}
            />
          )}
          <CheckInButton player={player} clubId={clubId} canToggle={canManage} />
          {isSelf && <LeaveButton clubId={clubId} />}
          {canManage && !isSelf && <KickButton clubId={clubId} playerId={player.id} playerName={player.display_name} />}
        </span>
      </div>

      {/* Edit form — expands below main row */}
      {canManage && editOpen && (
        <EditPlayerForm
          player={player}
          clubId={clubId}
          levels={levels}
          onClose={() => setEditOpen(false)}
        />
      )}

      {/* Partial-session label under the name (shown to everyone) */}
      {isPartial && (
        <div className="flex items-center gap-1 pl-8 mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          <Clock className="h-3 w-3 shrink-0" />
          {t("partialPlay", { start: effStart ?? "", end: effEnd ?? "" })}
        </div>
      )}
    </>
  );
}

// ─── Sortable row (active players only) ──────────────────────────────────────

function SortableItem({
  player,
  index,
  clubId,
  sessionProfileId,
  canManage,
  sessionStart,
  sessionEnd,
  levels,
  selectMode,
  selected,
  onToggleSelect,
}: {
  player: ClubPlayer;
  index: number;
  clubId: string;
  sessionProfileId: string | null;
  canManage: boolean;
  sessionStart?: string;
  sessionEnd?: string;
  levels?: Level[];
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const t = useTranslations("club.playerList");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
    // Disable drag when in select mode
    disabled: !canManage || selectMode,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isCheckedIn = !!player.checked_in_at;

  const dragHandle = canManage && !selectMode ? (
    <button
      {...attributes}
      {...listeners}
      className="flex h-9 w-9 -ml-1.5 items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground touch-none"
      aria-label={t("dragAriaLabel")}
      type="button"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  ) : null;

  const selectCheckbox = selectMode ? (
    <Checkbox
      checked={selected}
      onCheckedChange={() => onToggleSelect(player.id)}
      className="shrink-0"
      aria-label={player.display_name}
    />
  ) : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-col border rounded px-3 py-2 bg-background transition-colors text-sm",
        isCheckedIn && "border-green-500/30 bg-green-500/5 dark:bg-green-500/5",
        selected && "ring-1 ring-primary/60 bg-primary/5",
      )}
    >
      <PlayerRowBody
        player={player}
        clubId={clubId}
        sessionProfileId={sessionProfileId}
        canManage={canManage}
        sessionStart={sessionStart}
        sessionEnd={sessionEnd}
        levels={levels}
        dragHandle={dragHandle}
        positionLabel={`${index + 1}.`}
        selectCheckbox={selectCheckbox}
      />
    </li>
  );
}

// ─── Reserve row (draggable → drop into active list to promote) ───────────────

function ReserveItem({
  player,
  rank,
  clubId,
  sessionProfileId,
  canManage,
  sessionStart,
  sessionEnd,
  levels,
  selectMode,
  selected,
  onToggleSelect,
}: {
  player: ClubPlayer;
  rank: number;
  clubId: string;
  sessionProfileId: string | null;
  canManage: boolean;
  sessionStart?: string;
  sessionEnd?: string;
  levels?: Level[];
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const t = useTranslations("club.playerList");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
    disabled: !canManage || selectMode,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 0.7,
  };

  const dragHandle = canManage && !selectMode ? (
    <button
      {...attributes}
      {...listeners}
      className="flex h-9 w-9 -ml-1.5 items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground touch-none"
      aria-label={t("dragReserveAriaLabel")}
      type="button"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  ) : null;

  const selectCheckbox = selectMode ? (
    <Checkbox
      checked={selected}
      onCheckedChange={() => onToggleSelect(player.id)}
      className="shrink-0"
      aria-label={player.display_name}
    />
  ) : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-col border rounded px-3 py-2 bg-background text-sm",
        selected && "ring-1 ring-primary/60 bg-primary/5",
      )}
    >
      <PlayerRowBody
        player={player}
        clubId={clubId}
        sessionProfileId={sessionProfileId}
        canManage={canManage}
        sessionStart={sessionStart}
        sessionEnd={sessionEnd}
        levels={levels}
        dragHandle={dragHandle}
        positionLabel={`#${rank}`}
        selectCheckbox={selectCheckbox}
      />
    </li>
  );
}

// ─── Active drop zone — wraps the active list so a dragged reserve has a target ─

/** Stable id for the active-list droppable zone (distinct from any player UUID). */
const ACTIVE_ZONE_ID = "__active_zone__";

function ActiveDropZone({
  highlight,
  dropDisabled,
  children,
}: {
  /** True while a reserve is being dragged — show the "drop here to promote" cue. */
  highlight: boolean;
  /**
   * Disable the zone droppable when active rows exist — dropping onto any active
   * row already promotes a reserve, and an always-on zone (whose rect spans the
   * whole list) would out-compete individual rows in closestCenter and silently
   * no-op active reorders. The zone is only the drop target when active is empty.
   */
  dropDisabled: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("club.playerList");
  const { setNodeRef, isOver } = useDroppable({ id: ACTIVE_ZONE_ID, disabled: dropDisabled });
  // Affordance must match where a drop actually lands:
  //  - active empty (zone IS the droppable) → dashed "drop here" target + banner.
  //  - active has rows (zone disabled, rows are the targets) → only a subtle ring;
  //    a dashed "drop in this area" banner would be a false affordance, since a drop
  //    on the banner/padding resolves to the nearest row, not the zone.
  const showTarget = highlight && !dropDisabled;
  const showRing = highlight && dropDisabled;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md transition-colors",
        showTarget &&
          `border-2 border-dashed p-1 ${
            isOver ? "border-primary bg-primary/10" : "border-primary/40 bg-primary/5"
          }`,
        showRing && "ring-1 ring-primary/40",
      )}
    >
      {showTarget && (
        <p className="px-2 py-1 text-center text-[11px] font-medium text-primary">
          {t("dropToPromote")}
        </p>
      )}
      {children}
    </div>
  );
}

// ─── Main list ────────────────────────────────────────────────────────────────

export function SortablePlayerList({
  clubId,
  players,
  sessionProfileId,
  canManage,
  levels,
  sessionStart,
  sessionEnd,
}: Props) {
  const t = useTranslations("club.playerList");
  const tBulk = useTranslations("club.bulkSelect");
  const [items, setItems] = useState(players);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const dndId = useId();
  const router = useRouter();
  // True while an optimistic promote/reorder is in flight. The 30s auto-refresh
  // skips its tick during this window so a stale server snapshot can't revert the
  // optimistic state mid-action. (A ref, not state, so it doesn't churn `refresh`'s
  // identity and reset the interval.) Note: this only guards the timer — `players`
  // changing from any OTHER parent re-render still reconciles via the effect below.
  const mutatingRef = useRef(false);

  // ─── Selection mode state ────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function togglePlayerSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  useEffect(() => { setItems(players); }, [players]);

  // When players list changes externally (e.g. after bulk delete), prune stale ids.
  useEffect(() => {
    const validIds = new Set(players.map((p) => p.id));
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => validIds.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [players]);

  const refresh = useCallback(() => {
    if (mutatingRef.current) return;
    startRefresh(() => { router.refresh(); });
  }, [router]);

  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Split into active and reserve; preserve relative order within each group.
  const active = items.filter((p) => p.status === "active");
  const reserve = items.filter((p) => p.status === "reserve");
  // A reserve is mid-drag → highlight the active list as the promote drop target.
  const draggingReserve = draggingId != null && reserve.some((p) => p.id === draggingId);

  // Select-all state: all = every player checked, partial = some.
  const allPlayerIds = items.map((p) => p.id);
  const allSelected = allPlayerIds.length > 0 && allPlayerIds.every((id) => selectedIds.has(id));
  const partialSelected = !allSelected && allPlayerIds.some((id) => selectedIds.has(id));

  function handleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allPlayerIds));
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active: dragActive, over } = event;
    if (!over) return;

    const draggedId = String(dragActive.id);
    const overId = String(over.id);
    const isReserveDragged = reserve.some((p) => p.id === draggedId);
    const overActive = overId === ACTIVE_ZONE_ID || active.some((p) => p.id === overId);

    // Reserve dragged into the active list → promote (admin override, ignores cap).
    if (isReserveDragged) {
      if (!overActive) return; // dropped back among reserves → no-op (cancel)
      // Optimistic: flip status; the filters re-derive active/reserve. The page
      // orders club_players by position ASC and the server promote keeps position,
      // so a reserve (joined-later → higher position) renders at the active tail on
      // both the optimistic array and the next server snapshot.
      setItems((prev) =>
        prev.map((p) => (p.id === draggedId ? { ...p, status: "active" } : p)),
      );
      mutatingRef.current = true;
      startTransition(async () => {
        try {
          const res = await promoteClubReserveAction({ clubId, playerId: draggedId });
          if ("error" in res) {
            toast.error(res.error);
            router.refresh(); // revert optimistic flip from server truth
          }
        } finally {
          mutatingRef.current = false;
        }
      });
      return;
    }

    // Active row reordered within the active list.
    if (draggedId === overId) return;
    const oldIndex = active.findIndex((p) => p.id === draggedId);
    const newIndex = active.findIndex((p) => p.id === overId);
    if (oldIndex === -1 || newIndex === -1) return; // dropped on zone/reserve → ignore
    const reorderedActive = arrayMove(active, oldIndex, newIndex);
    // Merge back: active first (reordered), reserves unchanged at tail.
    setItems([...reorderedActive, ...reserve]);
    mutatingRef.current = true;
    startTransition(async () => {
      try {
        // Requirement #3: pass ONLY active player ids.
        await reorderPlayersAction(clubId, reorderedActive.map((p) => p.id));
      } finally {
        mutatingRef.current = false;
      }
    });
  }

  const refreshBtn = (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={refresh}
      disabled={refreshing}
      aria-label={t("refreshAriaLabel")}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
    </Button>
  );

  if (!items.length) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">{t("noPlayers")}</p>
        {refreshBtn}
      </div>
    );
  }

  const checkedInCount = items.filter((p) => p.checked_in_at).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("autoRefresh")}</span>
          {checkedInCount > 0 && (
            <Badge
              variant="outline"
              className="text-xs text-green-600 dark:text-green-400 border-green-500/40 bg-green-500/10"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {t("readyBadge", { checked: checkedInCount, total: items.length })}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Select-mode toggle — canManage + ≥1 player */}
          {canManage && (
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant={selectMode ? "secondary" : "outline"}
                  size="xs"
                  onClick={toggleSelectMode}
                  aria-label={selectMode ? tBulk("doneMode") : tBulk("toggleMode")}
                >
                  {selectMode ? tBulk("doneMode") : tBulk("toggleMode")}
                </Button>
              } />
              <TooltipContent>
                {selectMode ? tBulk("doneMode") : tBulk("toggleMode")}
              </TooltipContent>
            </Tooltip>
          )}
          {refreshBtn}
        </div>
      </div>

      {/* Select-all row */}
      {selectMode && (
        <div className="flex items-center gap-2 px-1 py-1 text-sm">
          <Checkbox
            checked={allSelected}
            indeterminate={partialSelected}
            onCheckedChange={handleSelectAll}
            aria-label={tBulk("selectAll", { n: items.length })}
          />
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={handleSelectAll}
          >
            {tBulk("selectAll", { n: items.length })}
          </button>
        </div>
      )}

      {/* One DndContext over both lists so a reserve can be dragged up into the
          active list (→ promote) as well as active rows reordered among themselves. */}
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        {/* Active players — drag-reorderable; also the drop target to promote a reserve */}
        <ActiveDropZone highlight={draggingReserve} dropDisabled={active.length > 0}>
          <SortableContext items={active.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-1">
              {active.length === 0 ? (
                <li className="rounded border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                  {t("noActive")}
                </li>
              ) : (
                active.map((p, i) => (
                  <SortableItem
                    key={p.id}
                    player={p}
                    index={i}
                    clubId={clubId}
                    sessionProfileId={sessionProfileId}
                    canManage={canManage}
                    sessionStart={sessionStart}
                    sessionEnd={sessionEnd}
                    levels={levels}
                    selectMode={selectMode}
                    selected={selectedIds.has(p.id)}
                    onToggleSelect={togglePlayerSelect}
                  />
                ))
              )}
            </ol>
          </SortableContext>
        </ActiveDropZone>

        {/* Reserve players — drag up into the active list to promote */}
        {reserve.length > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">{t("reserveLabel", { count: reserve.length })}</span>
              <Badge variant="secondary" className="text-xs">{t("reserveQueueBadge")}</Badge>
              {canManage && !selectMode && (
                <span className="text-[11px] text-muted-foreground">{t("dragUpHint")}</span>
              )}
            </div>
            <SortableContext items={reserve.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-1">
                {reserve.map((p, i) => (
                  <ReserveItem
                    key={p.id}
                    player={p}
                    rank={i + 1}
                    clubId={clubId}
                    sessionProfileId={sessionProfileId}
                    canManage={canManage}
                    sessionStart={sessionStart}
                    sessionEnd={sessionEnd}
                    levels={levels}
                    selectMode={selectMode}
                    selected={selectedIds.has(p.id)}
                    onToggleSelect={togglePlayerSelect}
                  />
                ))}
              </ol>
            </SortableContext>
          </div>
        )}
      </DndContext>

      {/* Bulk action bar — sticky bottom, visible when ≥1 selected */}
      {selectMode && selectedIds.size > 0 && (
        <BulkActionBar
          clubId={clubId}
          selectedIds={selectedIds}
          allPlayers={items}
          levels={levels}
          sessionStart={sessionStart}
          sessionEnd={sessionEnd}
          onClearSelection={clearSelection}
        />
      )}
    </div>
  );
}
