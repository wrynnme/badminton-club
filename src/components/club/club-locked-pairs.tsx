"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown, Link2, Unlink, Users } from "lucide-react";
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
import type { ClubLockedPair } from "@/lib/types";

// ─── Props ─────────────────────────────────────────────────────────────────────

type Player = { id: string; display_name: string };

export function ClubLockedPairs({
  clubId,
  players,
  locks,
  canManage,
}: {
  clubId: string;
  players: Player[];
  locks: ClubLockedPair[];
  canManage: boolean;
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
        <CardHeader className="pb-3">
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
          <CardContent className="space-y-4">
            {/* Create form — canManage only */}
            {canManage && (
              <CreateLockForm
                clubId={clubId}
                players={players}
                nameMap={nameMap}
                onSuccess={() => router.refresh()}
              />
            )}

            {/* Active locks list */}
            <LockList
              locks={locks}
              nameMap={nameMap}
              canManage={canManage}
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
  onSuccess,
}: {
  clubId: string;
  players: Player[];
  nameMap: Map<string, string>;
  onSuccess: () => void;
}) {
  const t = useTranslations("club.lockedPairs");
  const [player1Id, setPlayer1Id] = useState<string>("");
  const [player2Id, setPlayer2Id] = useState<string>("");
  const [mode, setMode] = useState<"forever" | "n_games">("forever");
  const [nGames, setNGames] = useState(3);
  const [busy, startTransition] = useTransition();

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
  nameMap,
  canManage,
  onSuccess,
}: {
  locks: ClubLockedPair[];
  nameMap: Map<string, string>;
  canManage: boolean;
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
          nameMap={nameMap}
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
  nameMap,
  canManage,
  onSuccess,
}: {
  lock: ClubLockedPair;
  nameMap: Map<string, string>;
  canManage: boolean;
  onSuccess: () => void;
}) {
  const t = useTranslations("club.lockedPairs");
  const [busy, startTransition] = useTransition();

  const name1 = nameMap.get(lock.player1_id) ?? "—";
  const name2 = nameMap.get(lock.player2_id) ?? "—";

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

      <Badge
        variant="secondary"
        className="text-xs shrink-0"
      >
        {lock.games_remaining == null
          ? t("badgeForever")
          : t("badgeRemaining", { count: lock.games_remaining })}
      </Badge>

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
