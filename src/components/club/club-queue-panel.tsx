"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Play, X, Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildNextClubMatchAction,
  startClubMatchAction,
  finishClubMatchAction,
  cancelClubMatchAction,
} from "@/lib/actions/clubs";
import type { ClubMatch } from "@/lib/types";
import type { ClubQueueSettings } from "@/lib/club/queue-settings";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatElapsed(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (elapsedMs < 0) return "0:00";
  const totalSec = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function resolveSide(
  player1: string,
  player2: string | null,
  nameMap: Map<string, string>,
): string {
  const n1 = nameMap.get(player1) ?? "—";
  if (!player2) return n1;
  const n2 = nameMap.get(player2) ?? "—";
  return `${n1} / ${n2}`;
}

// ─── Elapsed ticker — updates every second for a single in_progress match ────

function ElapsedTicker({ startedAt }: { startedAt: string }) {
  const [display, setDisplay] = useState("0:00");

  useEffect(() => {
    setDisplay(formatElapsed(startedAt));
    const id = setInterval(() => {
      setDisplay(formatElapsed(startedAt));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span className="text-xs tabular-nums text-muted-foreground">{display}</span>
  );
}

// ─── Pending match row ────────────────────────────────────────────────────────

function PendingRow({
  match,
  nameMap,
  canManage,
  onRefresh,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const [startBusy, startTransition] = useTransition();
  const [cancelBusy, cancelTransition] = useTransition();

  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);

  function handleStart() {
    startTransition(async () => {
      const res = await startClubMatchAction(match.id);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        onRefresh();
      }
    });
  }

  function handleCancel() {
    cancelTransition(async () => {
      const res = await cancelClubMatchAction(match.id);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        onRefresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-2 py-2 border-b last:border-0">
      <Badge variant="outline" className="shrink-0 text-xs">
        สนาม {match.court}
      </Badge>
      <span className="flex-1 text-sm truncate">
        {sideA} <span className="text-muted-foreground">vs</span> {sideB}
      </span>
      {canManage && (
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 px-2"
                  disabled={startBusy}
                  onClick={handleStart}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>เริ่มแมตช์ที่สนาม {match.court}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  disabled={cancelBusy}
                  onClick={handleCancel}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>ยกเลิกแมตช์</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ─── In-progress match row ────────────────────────────────────────────────────

function InProgressRow({
  match,
  nameMap,
  canManage,
  onRefresh,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishBusy, finishTransition] = useTransition();

  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);

  function handleFinish(winnerSide?: "a" | "b") {
    finishTransition(async () => {
      const res = await finishClubMatchAction({
        matchId: match.id,
        winnerSide,
      });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        setFinishOpen(false);
        onRefresh();
      }
    });
  }

  return (
    <div className="py-2 border-b last:border-0">
      <div className="flex items-center gap-2">
        <Badge className="shrink-0 text-xs bg-warning/20 text-warning-foreground border-warning/40">
          สนาม {match.court}
        </Badge>
        <span className="flex-1 text-sm truncate">
          {sideA} <span className="text-muted-foreground">vs</span> {sideB}
        </span>
        {match.started_at && (
          <ElapsedTicker startedAt={match.started_at} />
        )}
        {canManage && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 shrink-0"
                  disabled={finishBusy}
                  onClick={() => setFinishOpen((o) => !o)}
                >
                  {finishOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  <span className="text-xs ml-1">จบแข่ง</span>
                </Button>
              }
            />
            <TooltipContent>บันทึกผลแมตช์สนาม {match.court}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {finishOpen && canManage && (
        <div className="mt-2 ml-2 flex flex-wrap gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  disabled={finishBusy}
                  onClick={() => handleFinish("a")}
                >
                  <Trophy className="h-3 w-3 mr-1" />
                  ฝั่ง A ชนะ
                </Button>
              }
            />
            <TooltipContent>{sideA} ชนะ</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  disabled={finishBusy}
                  onClick={() => handleFinish("b")}
                >
                  <Trophy className="h-3 w-3 mr-1" />
                  ฝั่ง B ชนะ
                </Button>
              }
            />
            <TooltipContent>{sideB} ชนะ</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={finishBusy}
                  onClick={() => handleFinish(undefined)}
                >
                  จบแบบไม่ระบุผล
                </Button>
              }
            />
            <TooltipContent>บันทึกว่าจบโดยไม่มีผู้ชนะ</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ─── Completed match row ──────────────────────────────────────────────────────

function CompletedRow({
  match,
  nameMap,
}: {
  match: ClubMatch;
  nameMap: Map<string, string>;
}) {
  const sideA = resolveSide(match.side_a_player1, match.side_a_player2, nameMap);
  const sideB = resolveSide(match.side_b_player1, match.side_b_player2, nameMap);

  const winnerA = match.winner_side === "a";
  const winnerB = match.winner_side === "b";

  return (
    <div className="flex items-center gap-2 py-2 border-b last:border-0 text-sm text-muted-foreground">
      <Badge variant="outline" className="shrink-0 text-xs opacity-60">
        สนาม {match.court}
      </Badge>
      <span className={winnerA ? "text-winner font-medium" : ""}>{sideA}</span>
      <span className="text-xs">vs</span>
      <span className={winnerB ? "text-winner font-medium" : ""}>{sideB}</span>
      {match.winner_side && (
        <Trophy className="h-3.5 w-3.5 text-warning shrink-0 ml-auto" />
      )}
    </div>
  );
}

// ─── Per-court build button ───────────────────────────────────────────────────

function BuildButton({
  clubId,
  court,
  onRefresh,
}: {
  clubId: string;
  court: number;
  onRefresh: () => void;
}) {
  const [busy, transition] = useTransition();

  function handleBuild() {
    transition(async () => {
      const res = await buildNextClubMatchAction(clubId, court);
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(`สร้างแมตช์สนาม ${court} แล้ว`);
        onRefresh();
      }
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            disabled={busy}
            onClick={handleBuild}
          >
            <Plus className="h-3.5 w-3.5" />
            สนาม {court}
          </Button>
        }
      />
      <TooltipContent>สร้างแมตช์ถัดไปสำหรับสนาม {court}</TooltipContent>
    </Tooltip>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ClubQueuePanel({
  clubId,
  matches,
  players,
  settings,
  canManage,
}: {
  clubId: string;
  matches: ClubMatch[];
  players: { id: string; display_name: string }[];
  settings: ClubQueueSettings;
  canManage: boolean;
}) {
  const router = useRouter();

  // Build a stable name-resolution map
  const nameMap = useRef(new Map<string, string>());
  useEffect(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.display_name);
    nameMap.current = m;
  }, [players]);
  // Also initialise synchronously for SSR/first paint
  if (nameMap.current.size === 0 && players.length > 0) {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.display_name);
    nameMap.current = m;
  }

  function onRefresh() {
    router.refresh();
  }

  const pending = matches
    .filter((m) => m.status === "pending")
    .sort(
      (a, b) => (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity),
    );

  const inProgress = matches.filter((m) => m.status === "in_progress");

  const completed = matches
    .filter((m) => m.status === "completed")
    .sort(
      (a, b) =>
        new Date(b.ended_at ?? b.created_at).getTime() -
        new Date(a.ended_at ?? a.created_at).getTime(),
    )
    .slice(0, 15);

  const courts = Array.from(
    { length: settings.court_count },
    (_, i) => i + 1,
  );

  return (
    <Tabs defaultValue="pending" className="space-y-3">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="pending" className="gap-1.5">
          รอแข่ง{" "}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {pending.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="in_progress" className="gap-1.5">
          กำลังแข่ง{" "}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {inProgress.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="completed" className="gap-1.5">
          จบแล้ว{" "}
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {completed.length}
          </Badge>
        </TabsTrigger>
      </TabsList>

      {/* ── รอแข่ง tab ── */}
      <TabsContent value="pending" className="space-y-3 mt-0">
        {canManage && courts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {courts.map((c) => (
              <BuildButton
                key={c}
                clubId={clubId}
                court={c}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        )}

        <Card>
          <CardContent className="py-3 px-4">
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                ยังไม่มีแมตช์ในคิว
              </p>
            ) : (
              pending.map((m) => (
                <PendingRow
                  key={m.id}
                  match={m}
                  nameMap={nameMap.current}
                  canManage={canManage}
                  onRefresh={onRefresh}
                />
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── กำลังแข่ง tab ── */}
      <TabsContent value="in_progress" className="mt-0">
        <Card>
          <CardContent className="py-3 px-4">
            {inProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                ไม่มีแมตช์กำลังแข่งขัน
              </p>
            ) : (
              inProgress.map((m) => (
                <InProgressRow
                  key={m.id}
                  match={m}
                  nameMap={nameMap.current}
                  canManage={canManage}
                  onRefresh={onRefresh}
                />
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── จบแล้ว tab ── */}
      <TabsContent value="completed" className="mt-0">
        <Card>
          <CardContent className="py-3 px-4">
            {completed.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                ยังไม่มีแมตช์ที่จบแล้ว
              </p>
            ) : (
              completed.map((m) => (
                <CompletedRow
                  key={m.id}
                  match={m}
                  nameMap={nameMap.current}
                />
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
