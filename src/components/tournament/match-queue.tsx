"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Loader2, Play, ClipboardEdit, RotateCcw, Shuffle, CheckCircle2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScoreForm } from "@/components/tournament/score-form";
import {
  reorderMatchQueueAction,
  setMatchCourtAction,
  startMatchAction,
  resetMatchScoreAction,
  autoRotateQueueAction,
} from "@/lib/actions/matches";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import type { Match, MatchUnit } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

const STATUS_LABEL: Record<Match["status"], string> = {
  pending: "รอแข่ง",
  in_progress: "กำลังแข่ง",
  completed: "จบแล้ว",
};

const STATUS_TONE: Record<Match["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
};

function matchKey(m: Match) {
  return m.queue_position ?? m.match_number;
}

function sortMatches(list: Match[]) {
  return [...list].sort((x, y) => matchKey(x) - matchKey(y));
}

export function MatchQueue({
  matches,
  competitorById,
  tournamentId,
  unit,
  canEdit,
  courts = [],
}: {
  matches: Match[];
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  unit: MatchUnit;
  canEdit: boolean;
  courts?: string[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Match[]>([]);
  const [reorderPending, startReorder] = useTransition();
  const [autoPending, startAuto] = useTransition();

  // keep local state in sync with server-side `matches`
  useEffect(() => {
    setItems(sortMatches(matches));
  }, [matches]);

  const pending = useMemo(() => items.filter((m) => m.status === "pending"), [items]);
  const inProgress = useMemo(() => items.filter((m) => m.status === "in_progress"), [items]);
  const completed = useMemo(() => items.filter((m) => m.status === "completed"), [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pending.findIndex((m) => m.id === active.id);
    const newIndex = pending.findIndex((m) => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(pending, oldIndex, newIndex);
    const merged = [...reordered, ...inProgress, ...completed];
    setItems(merged);

    const allIds = merged.map((m) => m.id);
    startReorder(async () => {
      const res = await reorderMatchQueueAction(tournamentId, allIds);
      if (res && "error" in res) {
        toast.error(res.error);
        setItems(sortMatches(matches));
      } else {
        toast.success("จัดลำดับใหม่แล้ว");
        router.refresh();
      }
    });
  };

  if (matches.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          ยังไม่มีแมตช์
        </CardContent>
      </Card>
    );
  }

  // Map court name → in_progress match using it
  const courtOccupier = new Map<string, Match>();
  for (const m of inProgress) {
    if (m.court) courtOccupier.set(m.court, m);
  }

  return (
    <div className="space-y-4">
      {courts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">สถานะสนาม</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {courts.map((courtName) => {
                const occ = courtOccupier.get(courtName);
                const a = occ
                  ? (unit === "team" ? occ.team_a_id : occ.pair_a_id)
                  : null;
                const b = occ
                  ? (unit === "team" ? occ.team_b_id : occ.pair_b_id)
                  : null;
                const aName = a ? competitorById.get(a)?.name ?? "—" : "";
                const bName = b ? competitorById.get(b)?.name ?? "—" : "";
                return (
                  <div
                    key={courtName}
                    className={`rounded-md border p-2 text-xs ${
                      occ ? "border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20" : "border-green-500/30 bg-green-50/40 dark:bg-green-950/20"
                    }`}
                  >
                    <div className="font-medium flex items-center justify-between gap-1">
                      <span className="truncate">{courtName}</span>
                      {occ ? (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">#{occ.match_number}</Badge>
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-muted-foreground">
                      {occ ? `${aName} vs ${bName}` : "ว่าง"}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            รอแข่ง <Badge variant="outline" className="text-xs">{pending.length}</Badge>
            {reorderPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </CardTitle>
          {canEdit && pending.length >= 2 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              disabled={autoPending}
              onClick={() => startAuto(async () => {
                const res = await autoRotateQueueAction(tournamentId);
                if (res && "error" in res) toast.error(res.error);
                else toast.success("จัดคิวใหม่ — หลีกเลี่ยงแข่งซ้อน");
              })}
            >
              {autoPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shuffle className="h-3 w-3" />}
              จัดคิวอัตโนมัติ
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">ไม่มีแมตช์รอแข่ง</p>
          ) : canEdit ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={pending.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {pending.map((m, i) => (
                    <SortableQueueRow
                      key={m.id}
                      match={m}
                      index={i + 1}
                      competitorById={competitorById}
                      tournamentId={tournamentId}
                      unit={unit}
                      canEdit
                      courts={courts}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <ul className="space-y-2">
              {pending.map((m, i) => (
                <QueueRowReadOnly
                  key={m.id}
                  match={m}
                  index={i + 1}
                  competitorById={competitorById}
                  unit={unit}
                  courts={courts}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {inProgress.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              กำลังแข่ง <Badge variant="outline" className="text-xs">{inProgress.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <ul className="space-y-2">
              {inProgress.map((m) => (
                <NonDraggableRow
                  key={m.id}
                  match={m}
                  competitorById={competitorById}
                  tournamentId={tournamentId}
                  unit={unit}
                  canEdit={canEdit}
                  courts={courts}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {completed.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              จบแล้ว <Badge variant="outline" className="text-xs">{completed.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <ul className="space-y-2">
              {completed.map((m) => (
                <NonDraggableRow
                  key={m.id}
                  match={m}
                  competitorById={competitorById}
                  tournamentId={tournamentId}
                  unit={unit}
                  canEdit={canEdit}
                  courts={courts}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

function getCompetitorNames(
  match: Match,
  unit: MatchUnit,
  competitorById: Map<string, Competitor>,
) {
  const aId = unit === "team" ? match.team_a_id : match.pair_a_id;
  const bId = unit === "team" ? match.team_b_id : match.pair_b_id;
  return {
    a: aId ? competitorById.get(aId) : undefined,
    b: bId ? competitorById.get(bId) : undefined,
    unknownLabel: unit === "team" ? "TBD" : "—",
  };
}

function StatusBadge({ status }: { status: Match["status"] }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function CompetitorLine({ c, unknownLabel }: { c?: Competitor; unknownLabel: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm truncate">
      {c?.color && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
      <span className="truncate">{c?.name ?? unknownLabel}</span>
    </div>
  );
}

function SortableQueueRow(props: {
  match: Match;
  index: number;
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  unit: MatchUnit;
  canEdit: true;
  courts: string[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.match.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="touch-none">
      <QueueRowBody
        match={props.match}
        index={props.index}
        competitorById={props.competitorById}
        tournamentId={props.tournamentId}
        unit={props.unit}
        canEdit={props.canEdit}
        dragHandleProps={{ ...attributes, ...listeners }}
        courts={props.courts}
      />
    </li>
  );
}

function NonDraggableRow(props: {
  match: Match;
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  unit: MatchUnit;
  canEdit: boolean;
  courts: string[];
}) {
  return (
    <li>
      <QueueRowBody
        match={props.match}
        index={null}
        competitorById={props.competitorById}
        tournamentId={props.tournamentId}
        unit={props.unit}
        canEdit={props.canEdit}
        dragHandleProps={null}
        courts={props.courts}
      />
    </li>
  );
}

function QueueRowReadOnly(props: {
  match: Match;
  index: number;
  competitorById: Map<string, Competitor>;
  unit: MatchUnit;
  courts: string[];
}) {
  return (
    <li>
      <QueueRowBody
        match={props.match}
        index={props.index}
        competitorById={props.competitorById}
        tournamentId=""
        unit={props.unit}
        canEdit={false}
        dragHandleProps={null}
        courts={props.courts}
      />
    </li>
  );
}

function QueueRowBody({
  match,
  index,
  competitorById,
  tournamentId,
  unit,
  canEdit,
  dragHandleProps,
  courts,
}: {
  match: Match;
  index: number | null;
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  unit: MatchUnit;
  canEdit: boolean;
  dragHandleProps: Record<string, unknown> | null;
  courts: string[];
}) {
  const { a, b, unknownLabel } = getCompetitorNames(match, unit, competitorById);
  const [court, setCourt] = useState(match.court ?? "");
  const [courtPending, startCourt] = useTransition();
  const [startPending, startStart] = useTransition();
  const [resetPending, startReset] = useTransition();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setCourt(match.court ?? "");
  }, [match.court]);

  const completedWinner = match.status === "completed" ? gameWinner(match.games) : null;
  const totals = match.status === "completed" ? sumGameScores(match.games) : null;

  const saveCourt = () => {
    if (!canEdit) return;
    if ((court || null) === (match.court || null)) return;
    startCourt(async () => {
      const res = await setMatchCourtAction({
        matchId: match.id,
        tournamentId,
        court: court || null,
      });
      if (res && "error" in res) {
        toast.error(res.error);
        setCourt(match.court ?? "");
      } else {
        toast.success("บันทึกสนามแล้ว");
      }
    });
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 p-2.5">
        {dragHandleProps && (
          <button
            type="button"
            {...dragHandleProps}
            aria-label="ลากเพื่อจัดลำดับ"
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        <div className="text-xs font-mono text-muted-foreground w-12 shrink-0">
          #{index ?? match.match_number}
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] sm:items-center gap-x-2 gap-y-0.5">
          <CompetitorLine c={a} unknownLabel={unknownLabel} />
          <span className="hidden sm:inline text-muted-foreground text-xs px-1">vs</span>
          <CompetitorLine c={b} unknownLabel={unknownLabel} />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {canEdit ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">สนาม</span>
              {courts.length > 0 ? (
                <Select
                  value={court || "__none"}
                  onValueChange={(v) => {
                    const next = !v || v === "__none" ? "" : String(v);
                    setCourt(next);
                    startCourt(async () => {
                      const res = await setMatchCourtAction({
                        matchId: match.id,
                        tournamentId,
                        court: next || null,
                      });
                      if (res && "error" in res) {
                        toast.error(res.error);
                        setCourt(match.court ?? "");
                      } else {
                        toast.success("บันทึกสนามแล้ว");
                      }
                    });
                  }}
                  disabled={courtPending || match.status === "completed"}
                >
                  <SelectTrigger className="h-7 w-24 text-xs px-2">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— ไม่ระบุ —</SelectItem>
                    {courts.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={court}
                  onChange={(e) => setCourt(e.target.value)}
                  onBlur={saveCourt}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  placeholder="—"
                  maxLength={40}
                  disabled={courtPending || match.status === "completed"}
                  className="h-7 w-16 text-xs px-1.5 text-center"
                />
              )}
              {courtPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          ) : (
            match.court && <Badge variant="outline" className="text-[10px]">สนาม {match.court}</Badge>
          )}

          <StatusBadge status={match.status} />

          {canEdit && match.status === "pending" && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs px-2 gap-1"
              disabled={startPending}
              onClick={() => startStart(async () => {
                const res = await startMatchAction(match.id, tournamentId);
                if (res && "error" in res) toast.error(res.error);
                else toast.success(`เริ่มแมตช์ #${match.match_number}`);
              })}
            >
              {startPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              เริ่ม
            </Button>
          )}

          {canEdit && match.status === "in_progress" && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs px-2 gap-1"
              onClick={() => setEditing(true)}
            >
              <ClipboardEdit className="h-3 w-3" />จบแข่ง
            </Button>
          )}

          {canEdit && match.status === "completed" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs px-2 gap-1"
              aria-label="รีเซ็ตผล"
              disabled={resetPending}
              onClick={() => startReset(async () => {
                const res = await resetMatchScoreAction(match.id, tournamentId);
                if (res && "error" in res) toast.error(res.error);
                else toast.success("รีเซ็ตผลแมตช์แล้ว");
              })}
            >
              {resetPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            </Button>
          )}
        </div>
      </div>

      {match.status === "completed" && totals && (
        <div className="px-3 pb-2 text-xs text-muted-foreground">
          ผล: {match.team_a_score ?? 0}:{match.team_b_score ?? 0} (รวม {totals.a}-{totals.b}) ·
          {" "}ผู้ชนะ:{" "}
          {completedWinner === "draw"
            ? "เสมอ"
            : completedWinner === "a"
              ? a?.name ?? unknownLabel
              : b?.name ?? unknownLabel}
        </div>
      )}

      {editing && (
        <div className="border-t px-3 py-2">
          <ScoreForm
            matchId={match.id}
            tournamentId={tournamentId}
            competitorA={a}
            competitorB={b}
            initialGames={match.games}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
