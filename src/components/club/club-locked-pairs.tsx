"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Link2, Unlink, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  createClubLockedPairAction,
  releaseClubLockedPairAction,
} from "@/lib/actions/club-matches";
import {
  findLockedPairMismatches,
  type LockedPairMismatch,
  type LockPlayerTimes,
} from "@/lib/club/queue-preview";
import {
  countLockedTeammateMatches,
  deriveLockRemaining,
  type BatchCountableMatch,
} from "@/lib/club/batch-queue";
import type { ClubLockedPair } from "@/lib/types";

// ─── Props ─────────────────────────────────────────────────────────────────────

type Player = LockPlayerTimes;

export function ClubLockedPairs({
  clubId,
  players,
  locks,
  matches,
  canManage,
  clubStart,
  clubEnd,
}: {
  clubId: string;
  players: Player[];
  locks: ClubLockedPair[];
  /** non-cancelled matches — used to derive each N-game lock's live remaining
   *  (quota − teammate matches already queued/played) */
  matches: BatchCountableMatch[];
  canManage: boolean;
  /** "HH:MM" club session window — used to flag locked pairs with unequal presence. */
  clubStart: string;
  clubEnd: string;
}) {
  const t = useTranslations("club.lockedPairs");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Build a stable name-resolution map (keyed on club_players.id = p.id)
  const nameMap = new Map<string, string>(
    players.map((p) => [p.id, p.display_name]),
  );

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center gap-1.5 text-left font-heading text-sm leading-snug font-medium"
              />
            }
          >
            <Users className="h-4 w-4 shrink-0" />
            {t("title")}
            {locks.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({locks.length})
              </span>
            )}
            <ChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
            />
          </CollapsibleTrigger>
          <p className="text-xs text-muted-foreground">
            {t("description")}
          </p>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4 py-3">
            {/* Create form — canManage only */}
            {canManage && (
              <CreateLockForm
                clubId={clubId}
                players={players}
                nameMap={nameMap}
                clubStart={clubStart}
                clubEnd={clubEnd}
                onSuccess={() => router.refresh()}
              />
            )}

            {/* Active locks list */}
            <LockList
              locks={locks}
              players={players}
              matches={matches}
              nameMap={nameMap}
              canManage={canManage}
              clubStart={clubStart}
              clubEnd={clubEnd}
              onSuccess={() => router.refresh()}
            />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ─── Create form ───────────────────────────────────────────────────────────────

function CreateLockForm({
  clubId,
  players,
  nameMap,
  clubStart,
  clubEnd,
  onSuccess,
}: {
  clubId: string;
  players: Player[];
  nameMap: Map<string, string>;
  clubStart: string;
  clubEnd: string;
  onSuccess: () => void;
}) {
  const t = useTranslations("club.lockedPairs");
  const [player1Id, setPlayer1Id] = useState<string>("");
  const [player2Id, setPlayer2Id] = useState<string>("");
  const [mode, setMode] = useState<"forever" | "n_games">("forever");
  const [nGames, setNGames] = useState(3);
  const [busy, startTransition] = useTransition();

  // Warn when the two selected players are present for different amounts of the
  // session — a lock forces them to play together, so the shorter-staying one is
  // dragged up to the other's match count, overriding their (lower) pro-rated target.
  const mismatch =
    player1Id && player2Id && player1Id !== player2Id
      ? findLockedPairMismatches(
          players,
          [{ player1_id: player1Id, player2_id: player2Id }],
          clubStart,
          clubEnd,
        )[0]
      : undefined;

  const canSubmit =
    !busy &&
    player1Id !== "" &&
    player2Id !== "" &&
    player1Id !== player2Id &&
    (mode === "forever" || nGames >= 1);

  function handleSubmit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await createClubLockedPairAction({
        clubId,
        player1Id,
        player2Id,
        games: mode === "forever" ? null : nGames,
      });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("toastLocked"));
        setPlayer1Id("");
        setPlayer2Id("");
        setMode("forever");
        setNGames(3);
        onSuccess();
      }
    });
  }

  return (
    <div className="space-y-3 pb-3 border-b">
      {/* Player selects */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{t("player1Label")}</Label>
          <Select value={player1Id} onValueChange={(v) => setPlayer1Id(v ?? "")}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue>
                {(v: string) =>
                  v ? (nameMap.get(v) ?? "—") : t("selectPlayer")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {players.map((p) => (
                <SelectItem
                  key={p.id}
                  value={p.id}
                  disabled={p.id === player2Id}
                >
                  {p.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">{t("player2Label")}</Label>
          <Select value={player2Id} onValueChange={(v) => setPlayer2Id(v ?? "")}>

            <SelectTrigger className="h-8 text-sm">
              <SelectValue>
                {(v: string) =>
                  v ? (nameMap.get(v) ?? "—") : t("selectPlayer")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {players.map((p) => (
                <SelectItem
                  key={p.id}
                  value={p.id}
                  disabled={p.id === player1Id}
                >
                  {p.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Duration mode */}
      <div className="flex items-center gap-2">
        <Label className="text-xs shrink-0">{t("durationLabel")}</Label>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "forever" ? "default" : "outline"}
            className="h-7 text-xs px-3"
            onClick={() => setMode("forever")}
          >
            {t("durationForever")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "n_games" ? "default" : "outline"}
            className="h-7 text-xs px-3"
            onClick={() => setMode("n_games")}
          >
            {t("durationNGames")}
          </Button>
        </div>

        {mode === "n_games" && (
          <Input
            type="number"
            min={1}
            value={nGames}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 1) setNGames(n);
            }}
            className="w-16 h-7 text-sm"
          />
        )}
      </div>

      {/* Time-mismatch warning */}
      {mismatch && (
        <div className="flex gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>
            {t("windowWarnCreate", {
              shorter: mismatch.shorterName,
              longer: mismatch.longerName,
            })}
          </span>
        </div>
      )}

      {/* Submit */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              <Link2 className="h-3.5 w-3.5" />
              {t("lockButton")}
            </Button>
          }
        />
        <TooltipContent>
          {t("lockTooltip")}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Lock list ─────────────────────────────────────────────────────────────────

function LockList({
  locks,
  players,
  matches,
  nameMap,
  canManage,
  clubStart,
  clubEnd,
  onSuccess,
}: {
  locks: ClubLockedPair[];
  players: Player[];
  matches: BatchCountableMatch[];
  nameMap: Map<string, string>;
  canManage: boolean;
  clubStart: string;
  clubEnd: string;
  onSuccess: () => void;
}) {
  const t = useTranslations("club.lockedPairs");
  if (locks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-3">
        {t("empty")}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {locks.map((lock) => (
        <LockRow
          key={lock.id}
          lock={lock}
          teammateCount={countLockedTeammateMatches(
            matches,
            lock.player1_id,
            lock.player2_id,
          )}
          nameMap={nameMap}
          mismatch={
            findLockedPairMismatches(players, [lock], clubStart, clubEnd)[0]
          }
          canManage={canManage}
          onSuccess={onSuccess}
        />
      ))}
    </div>
  );
}

// ─── Single lock row ───────────────────────────────────────────────────────────

function LockRow({
  lock,
  teammateCount,
  nameMap,
  mismatch,
  canManage,
  onSuccess,
}: {
  lock: ClubLockedPair;
  /** matches where this pair are already teammates (queued + played) */
  teammateCount: number;
  nameMap: Map<string, string>;
  mismatch?: LockedPairMismatch;
  canManage: boolean;
  onSuccess: () => void;
}) {
  const t = useTranslations("club.lockedPairs");
  const [busy, startTransition] = useTransition();

  const name1 = nameMap.get(lock.player1_id) ?? "—";
  const name2 = nameMap.get(lock.player2_id) ?? "—";

  // games_remaining is the immutable quota (NULL = forever). Live remaining is
  // derived so cancel/delete refunds automatically. overBy > 0 = queued past quota.
  const quota = lock.games_remaining;
  const remaining = quota == null ? null : deriveLockRemaining(quota, teammateCount);
  const overBy = quota == null ? 0 : Math.max(0, teammateCount - quota);

  function handleRelease() {
    startTransition(async () => {
      const res = await releaseClubLockedPairAction(lock.id);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("toastReleased"));
        onSuccess();
      }
    });
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="flex-1 text-sm truncate">
        {name1}{" "}
        <span className="text-muted-foreground text-xs">+</span>{" "}
        {name2}
      </span>

      {mismatch && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="inline-flex shrink-0 text-warning-foreground"
                aria-label={t("windowWarnRow", {
                  shorter: mismatch.shorterName,
                  longer: mismatch.longerName,
                })}
              >
                <AlertTriangle className="h-4 w-4" />
              </button>
            }
          />
          <TooltipContent>
            {t("windowWarnRow", {
              shorter: mismatch.shorterName,
              longer: mismatch.longerName,
            })}
          </TooltipContent>
        </Tooltip>
      )}

      <Badge
        variant={overBy > 0 ? "outline" : "secondary"}
        className={`text-xs shrink-0${overBy > 0 ? " border-warning/40 text-warning-foreground" : ""}`}
      >
        {quota == null
          ? t("badgeForever")
          : t("badgeRemaining", { count: remaining ?? 0 })}
      </Badge>

      {overBy > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="inline-flex shrink-0 text-warning-foreground"
                aria-label={t("overQuota", { count: overBy })}
              >
                <AlertTriangle className="h-4 w-4" />
              </button>
            }
          />
          <TooltipContent>{t("overQuota", { count: overBy })}</TooltipContent>
        </Tooltip>
      )}

      {canManage && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0"
                disabled={busy}
                onClick={handleRelease}
              >
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <TooltipContent>{t("releaseTooltip")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
