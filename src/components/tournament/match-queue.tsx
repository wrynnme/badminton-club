"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
// Progress-bar-aware router for user mutations (reorder drag); the plain one
// stays for the realtime subscription refreshes so the bar doesn't fire on every event.
import { useRouter as useProgressRouter } from "@bprogress/next/app";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { GripVertical, Loader2, Play, ClipboardEdit, RotateCcw, Shuffle, CheckCircle2, Undo2 } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoreForm } from "@/components/tournament/score-form";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import {
  reorderMatchQueueAction,
  setMatchCourtAction,
  startMatchAction,
  resetMatchScoreAction,
  autoRotateQueueAction,
  cancelMatchAction,
} from "@/lib/actions/matches";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { parseDivision, divisionTone } from "@/lib/tournament/divisions";
import { classTone, type ClassTone } from "@/lib/tournament/class-color";
import { MATCH_STATUS_LABEL_TH, MATCH_STATUS_PILL_CLASS } from "@/lib/tournament/status-display";
import { maxGamesForFormat } from "@/lib/tournament/match-format";
import type { Match, MatchUnit, TournamentClass } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

// Canonical labels + pill tones now live in status-display.ts (shared with
// tv-match-card). Local aliases keep existing call sites unchanged.
const STATUS_LABEL = MATCH_STATUS_LABEL_TH;
const STATUS_TONE = MATCH_STATUS_PILL_CLASS;

// Sort: group matches before knockout (round_type alphabetical 'group' < 'knockout'),
// then by match_number. Mirrors server-side `.order("round_type").order("match_number")`
// in tournament page queries so client re-sort does not undo it.
function sortMatches(list: Match[]) {
  return [...list].sort((x, y) => {
    const r = (x.round_type ?? "").localeCompare(y.round_type ?? "");
    if (r !== 0) return r;
    return (x.match_number ?? 0) - (y.match_number ?? 0);
  });
}

export function MatchQueue({
  matches,
  competitorById,
  tournamentId,
  unit,
  canEdit,
  courts = [],
  requireCourtToStart = false,
  courtStrict = true,
  classById,
  realtimeSync = false,
}: {
  matches: Match[];
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  unit: MatchUnit;
  canEdit: boolean;
  courts?: string[];
  requireCourtToStart?: boolean;
  courtStrict?: boolean;
  classById?: Map<string, TournamentClass>;
  /** T5 — when true, patch match rows from realtime UPDATE payloads instead of
   *  waiting for the page-level debounced router.refresh. Additive + opt-in. */
  realtimeSync?: boolean;
}) {
  const router = useRouter();
  const progressRouter = useProgressRouter();
  const [items, setItems] = useState<Match[]>([]);

  // Build a stable id→tone map from classById insertion order (= position order from page).
  const classToneMap = useMemo(() => {
    if (!classById) return undefined;
    const m = new Map<string, ClassTone>();
    Array.from(classById.values()).forEach((c, i) => { m.set(c.id, classTone(i)); });
    return m;
  }, [classById]);
  const [reorderPending, startReorder] = useTransition();
  const [autoPending, startAuto] = useTransition();
  // T5: suppress realtime row-patches while the user is dragging or a reorder is
  // mid-flight, so an incoming queue_position UPDATE can't fight the optimistic order.
  const suppressPatchRef = useRef(false);

  // keep local state in sync with server-side `matches`
  useEffect(() => {
    setItems(sortMatches(matches));
  }, [matches]);

  // T5 — granular queue realtime: patch individual rows from UPDATE payloads
  // (matches has REPLICA IDENTITY FULL → payload.new carries every column). New /
  // removed matches need related data the payload lacks, so they fall back to a
  // full refresh. Off by default; the page-level wrapper's refresh stays the authority.
  useEffect(() => {
    if (!realtimeSync) return;
    const sb = createClient();
    const channel = sb
      .channel(`queue-sync:${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
        (payload) => {
          if (suppressPatchRef.current) return;
          const row = payload.new as Match;
          if (!row?.id) return;
          setItems((prev) =>
            prev.some((m) => m.id === row.id)
              ? sortMatches(prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)))
              : prev, // unknown id (e.g. just inserted) — let the refresh below add it
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [realtimeSync, tournamentId, router]);

  const pending = useMemo(() => items.filter((m) => m.status === "pending"), [items]);
  const inProgress = useMemo(() => items.filter((m) => m.status === "in_progress"), [items]);
  const completed = useMemo(() => items.filter((m) => m.status === "completed"), [items]);

  const occupiedCourts = useMemo(
    () => new Set(items.filter((m) => m.status === "in_progress" && m.court).map((m) => m.court!)),
    [items],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // T5: pause realtime patches for the whole drag → reorder → commit window.
  const onDragStart = () => { suppressPatchRef.current = true; };
  const onDragCancel = () => { suppressPatchRef.current = false; };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) { suppressPatchRef.current = false; return; }
    const oldIndex = pending.findIndex((m) => m.id === active.id);
    const newIndex = pending.findIndex((m) => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) { suppressPatchRef.current = false; return; }

    const reordered = arrayMove(pending, oldIndex, newIndex);
    const merged = [...reordered, ...inProgress, ...completed];
    setItems(merged);

    const allIds = merged.map((m) => m.id);
    startReorder(async () => {
      try {
        const res = await reorderMatchQueueAction(tournamentId, allIds);
        if (res && "error" in res) {
          toast.error(res.error);
          setItems(sortMatches(matches));
        } else {
          toast.success("จัดลำดับใหม่แล้ว");
          progressRouter.refresh();
        }
      } finally {
        // Re-enable realtime patches once the order is committed — even if the
        // action threw, so a rejected reorder can't leave patching dead until reload.
        suppressPatchRef.current = false;
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
        // Court status block is small (1-4 row grid) and frequently visible —
        // `content-visibility:auto` here caused visible CLS on scroll-in for
        // negligible perf benefit, so it's intentionally not applied.
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
                      occ ? "border-warning/40 bg-warning/10" : "border-success/30 bg-success/10"
                    }`}
                  >
                    <div className="font-medium flex items-center justify-between gap-1">
                      <span className="truncate">{courtName}</span>
                      {occ ? (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">#{occ.match_number}</Badge>
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
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

      <Tabs defaultValue="pending" className="space-y-3">
        <TabsList className="w-full flex-wrap h-auto">
          <TabsTrigger value="pending" className="gap-1.5">
            รอแข่ง <Badge variant="outline" className="text-[10px] px-1 py-0">{pending.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="in_progress" className="gap-1.5">
            กำลังแข่ง <Badge variant="outline" className="text-[10px] px-1 py-0">{inProgress.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-1.5">
            จบแล้ว <Badge variant="outline" className="text-[10px] px-1 py-0">{completed.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-2">
          {canEdit && pending.length >= 2 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                {reorderPending && <Loader2 className="h-3 w-3 animate-spin" />}
                ลากเพื่อจัดลำดับ
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
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
                  }
                />
                <TooltipContent>สลับลำดับเพื่อไม่ให้ผู้เล่นแข่งติดต่อกัน</TooltipContent>
              </Tooltip>
            </div>
          )}
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">ไม่มีแมตช์รอแข่ง</p>
          ) : canEdit ? (
            <DndContext id="match-queue-dnd" sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
              <SortableContext items={pending.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {pending.map((m) => (
                    <SortableQueueRow
                      key={m.id}
                      match={m}
                      competitorById={competitorById}
                      tournamentId={tournamentId}
                      unit={unit}
                      canEdit
                      courts={courts}
                      requireCourtToStart={requireCourtToStart}
                      courtStrict={courtStrict}
                      occupiedCourts={occupiedCourts}
                      classById={classById}
                      classToneMap={classToneMap}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <ul className="space-y-2">
              {pending.map((m) => (
                <QueueRowReadOnly
                  key={m.id}
                  match={m}
                  competitorById={competitorById}
                  unit={unit}
                  courts={courts}
                  classById={classById}
                  classToneMap={classToneMap}
                />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="in_progress" className="space-y-2">
          {inProgress.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">ไม่มีแมตช์ที่กำลังแข่ง</p>
          ) : (
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
                  requireCourtToStart={requireCourtToStart}
                  courtStrict={courtStrict}
                  occupiedCourts={occupiedCourts}
                  classById={classById}
                  classToneMap={classToneMap}
                />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-2">
          {completed.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">ยังไม่มีแมตช์ที่จบ</p>
          ) : (
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
                  requireCourtToStart={requireCourtToStart}
                  courtStrict={courtStrict}
                  occupiedCourts={occupiedCourts}
                  classById={classById}
                  classToneMap={classToneMap}
                />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
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

function DivisionBadge({
  match,
  classById,
  classToneMap,
}: {
  match: Match;
  classById?: Map<string, TournamentClass>;
  classToneMap?: Map<string, ClassTone>;
}) {
  const div = parseDivision(match.division);
  const isKO = match.round_type === "knockout";
  const cls = match.class_id ? classById?.get(match.class_id) : undefined;
  const clsTone = match.class_id ? classToneMap?.get(match.class_id) : undefined;
  const bracketLabel = !isKO
    ? null
    : match.bracket === "upper" ? "W" : match.bracket === "lower" ? "L" : match.bracket === "grand_final" ? "F" : null;

  // Only suppress when there is truly nothing to show.
  if (div == null && !isKO && !cls) return null;

  const bracketTooltip = !isKO
    ? null
    : match.bracket === "upper"
      ? "Winner bracket (สายชนะ)"
      : match.bracket === "lower"
      ? "Loser bracket (สายแพ้)"
      : match.bracket === "grand_final"
      ? "Grand Final (ชิงชนะเลิศ)"
      : null;

  return (
    <span className="flex items-center gap-0.5 shrink-0">
      {cls && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium cursor-help ${clsTone ? `${clsTone.border} ${clsTone.bg} ${clsTone.text}` : "border-primary/40 bg-primary/10 text-primary"}`}>
                {cls.code}
              </span>
            }
          />
          <TooltipContent>{cls.name}</TooltipContent>
        </Tooltip>
      )}
      {div != null && (() => {
        const tone = divisionTone(div);
        return (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium cursor-help ${tone.border} ${tone.bg} ${tone.text}`}>
                  D{div}
                </span>
              }
            />
            <TooltipContent>Division {div}</TooltipContent>
          </Tooltip>
        );
      })()}
      {isKO && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="text-[10px] px-1 py-0.5 rounded border font-medium cursor-help border-warning/40 bg-warning/10 text-warning">
                KO
              </span>
            }
          />
          <TooltipContent>น็อคเอ้า</TooltipContent>
        </Tooltip>
      )}
      {bracketLabel != null && bracketTooltip != null && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="text-[10px] px-1 py-0.5 rounded border font-medium cursor-help border-muted-foreground/30 bg-muted/40 text-muted-foreground">
                {bracketLabel}
              </span>
            }
          />
          <TooltipContent>{bracketTooltip}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: Match["status"] }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function CompetitorLine({
  c,
  unknownLabel,
  align = "left",
  entityType,
  entityId,
}: {
  c?: Competitor;
  unknownLabel: string;
  align?: "left" | "right";
  entityType: "pair" | "team";
  entityId: string | null | undefined;
}) {
  const isRight = align === "right";
  return (
    <div className={`flex items-center gap-1.5 text-xs sm:text-sm truncate ${isRight ? "justify-end" : ""}`}>
      {!isRight && c?.color && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
      <EntityLink entityType={entityType} entityId={entityId}>
        <span className="truncate">{c?.name ?? unknownLabel}</span>
      </EntityLink>
      {isRight && c?.color && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
    </div>
  );
}

function SortableQueueRow(props: {
  match: Match;
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  unit: MatchUnit;
  canEdit: true;
  courts: string[];
  requireCourtToStart: boolean;
  courtStrict: boolean;
  occupiedCourts: Set<string>;
  classById?: Map<string, TournamentClass>;
  classToneMap?: Map<string, ClassTone>;
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
        competitorById={props.competitorById}
        tournamentId={props.tournamentId}
        unit={props.unit}
        canEdit={props.canEdit}
        dragHandleProps={{ ...attributes, ...listeners }}
        courts={props.courts}
        requireCourtToStart={props.requireCourtToStart}
        courtStrict={props.courtStrict}
        occupiedCourts={props.occupiedCourts}
        classById={props.classById}
        classToneMap={props.classToneMap}
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
  requireCourtToStart: boolean;
  courtStrict: boolean;
  occupiedCourts: Set<string>;
  classById?: Map<string, TournamentClass>;
  classToneMap?: Map<string, ClassTone>;
}) {
  return (
    <li>
      <QueueRowBody
        match={props.match}
        competitorById={props.competitorById}
        tournamentId={props.tournamentId}
        unit={props.unit}
        canEdit={props.canEdit}
        dragHandleProps={null}
        courts={props.courts}
        requireCourtToStart={props.requireCourtToStart}
        courtStrict={props.courtStrict}
        occupiedCourts={props.occupiedCourts}
        classById={props.classById}
        classToneMap={props.classToneMap}
      />
    </li>
  );
}

function QueueRowReadOnly(props: {
  match: Match;
  competitorById: Map<string, Competitor>;
  unit: MatchUnit;
  courts: string[];
  classById?: Map<string, TournamentClass>;
  classToneMap?: Map<string, ClassTone>;
}) {
  return (
    <li>
      <QueueRowBody
        match={props.match}
        competitorById={props.competitorById}
        tournamentId=""
        unit={props.unit}
        canEdit={false}
        dragHandleProps={null}
        courts={props.courts}
        requireCourtToStart={false}
        courtStrict={true}
        occupiedCourts={new Set()}
        classById={props.classById}
        classToneMap={props.classToneMap}
      />
    </li>
  );
}

function QueueRowBody({
  match,
  competitorById,
  tournamentId,
  unit,
  canEdit,
  dragHandleProps,
  courts,
  requireCourtToStart,
  courtStrict,
  occupiedCourts,
  classById,
  classToneMap,
}: {
  match: Match;
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  unit: MatchUnit;
  canEdit: boolean;
  dragHandleProps: Record<string, unknown> | null;
  courts: string[];
  requireCourtToStart: boolean;
  courtStrict: boolean;
  occupiedCourts: Set<string>;
  classById?: Map<string, TournamentClass>;
  classToneMap?: Map<string, ClassTone>;
}) {
  const { a, b, unknownLabel } = getCompetitorNames(match, unit, competitorById);
  const isCourtOccupied = useMemo(
    () => occupiedCourts.has(match.court ?? ""),
    [match.court, occupiedCourts]
  );
  const [court, setCourt] = useState(match.court ?? "");
  const [courtPending, startCourt] = useTransition();
  const [startPending, startStart] = useTransition();
  const [resetPending, startReset] = useTransition();
  const [cancelPending, startCancel] = useTransition();
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 sm:p-2.5">
        <div className="flex items-center gap-2 min-w-0 sm:flex-1">
          {dragHandleProps && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    {...dragHandleProps}
                    aria-label="ลากเพื่อจัดลำดับ"
                    className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                }
              />
              <TooltipContent>ลากเพื่อจัดลำดับ</TooltipContent>
            </Tooltip>
          )}

          <div className="text-xs font-mono text-muted-foreground w-10 sm:w-12 shrink-0">
            #{match.match_number}
          </div>

          <DivisionBadge match={match} classById={classById} classToneMap={classToneMap} />

          <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-x-1">
            <CompetitorLine c={a} unknownLabel={unknownLabel} align="right" entityType={unit === "pair" ? "pair" : "team"} entityId={unit === "pair" ? match.pair_a_id : match.team_a_id} />
            <span className="text-muted-foreground text-xs">vs</span>
            <CompetitorLine c={b} unknownLabel={unknownLabel} align="left" entityType={unit === "pair" ? "pair" : "team"} entityId={unit === "pair" ? match.pair_b_id : match.team_b_id} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-start justify-end">
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
                    <SelectValue placeholder="-">
                      {(v: string | null) => (v && v !== "__none" ? v : "-")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">-</SelectItem>
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
                  placeholder="-"
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="default"
                    className="min-h-11 sm:min-h-8 text-xs px-2 gap-1"
                    disabled={
                      startPending ||
                      (requireCourtToStart && !match.court) ||
                      (!courtStrict && !!match.court && isCourtOccupied)
                    }
                    onClick={() => startStart(async () => {
                      const res = await startMatchAction(match.id, tournamentId);
                      if (res && "error" in res) toast.error(res.error);
                      else toast.success(`เริ่มแมตช์ #${match.match_number}`);
                    })}
                  >
                    {startPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    เริ่ม
                  </Button>
                }
              />
              <TooltipContent>
                {requireCourtToStart && !match.court
                  ? "ต้องเลือกสนามก่อน"
                  : !courtStrict && !!match.court && isCourtOccupied
                    ? `สนาม ${match.court} ถูกใช้อยู่`
                    : `เริ่มแมตช์ #${match.match_number} + แจ้งเตือน LINE`}
              </TooltipContent>
            </Tooltip>
          )}

          {canEdit && match.status === "in_progress" && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 sm:min-h-8 text-xs px-2 gap-1"
                      disabled={cancelPending}
                      onClick={() => startCancel(async () => {
                        const res = await cancelMatchAction(match.id, tournamentId);
                        if (res && "error" in res) toast.error(res.error);
                        else toast.success(`ยกเลิกการแข่งแมตช์ #${match.match_number}`);
                      })}
                    >
                      {cancelPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                      ยกเลิก
                    </Button>
                  }
                />
                <TooltipContent>ยกเลิกการแข่งแมตช์ #{match.match_number} → กลับเป็นรอแข่ง</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="sm"
                      variant="default"
                      className="min-h-11 sm:min-h-8 text-xs px-2 gap-1"
                      onClick={() => setEditing(true)}
                    >
                      <ClipboardEdit className="h-3 w-3" />จบแข่ง
                    </Button>
                  }
                />
                <TooltipContent>กรอกผลแมตช์ #{match.match_number}</TooltipContent>
              </Tooltip>
            </>
          )}

          {canEdit && match.status === "completed" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 sm:min-h-8 text-xs px-2 gap-1"
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
                }
              />
              <TooltipContent>รีเซ็ตผลแมตช์ #{match.match_number}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {match.status === "completed" && totals && (
        <div className="px-3 pb-2 text-xs text-muted-foreground">
          ผล: {match.team_a_score ?? 0}:{match.team_b_score ?? 0} ({match.games.length > 0 ? `${match.games.map((g) => `${g.a}-${g.b}`).join(", ")} · ` : ""}รวม {totals.a}-{totals.b}) ·
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
            maxGames={(() => {
              const fmt = match.class_id ? classById?.get(match.class_id)?.match_format : undefined;
              return fmt ? maxGamesForFormat(fmt) : undefined;
            })()}
          />
        </div>
      )}
    </div>
  );
}
