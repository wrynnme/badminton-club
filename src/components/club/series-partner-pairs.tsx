"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown, Link2, Unlink, Users2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addSeriesPartnerPairAction, removeSeriesPartnerPairAction } from "@/lib/actions/club-series";
import type { SeriesMember, SeriesPartnerPair } from "@/lib/types";

/**
 * Series-level partner pairs (ADR 0002 decision #6, "คู่ประจำ") — mirrors the
 * per-session `ClubLockedPairs` interaction (`club-locked-pairs.tsx`): pick 2
 * members, lock them; the list shows active pairs with a release action.
 * Instantiated into each new session's `club_locked_pairs` on "จัดก๊วน" (see
 * `buildLockedPairRows` in `src/lib/club/open-session.ts`) — only when both
 * members were actually seeded into that session's roster.
 */
export function SeriesPartnerPairs({
  seriesId,
  members,
  pairs,
}: {
  seriesId: string;
  members: SeriesMember[];
  pairs: SeriesPartnerPair[];
}) {
  const t = useTranslations("club.seriesPartnerPairs");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const nameMap = new Map<string, string>(members.map((m) => [m.id, m.canonical_name]));
  const pairedMemberIds = new Set<string>();
  for (const p of pairs) {
    pairedMemberIds.add(p.member1_id);
    pairedMemberIds.add(p.member2_id);
  }

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
            <Users2 className="h-4 w-4 shrink-0" />
            {t("title")}
            {pairs.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({pairs.length})</span>
            )}
            <ChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
            />
          </CollapsibleTrigger>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4 py-3">
            <CreatePairForm
              seriesId={seriesId}
              members={members}
              pairedMemberIds={pairedMemberIds}
              onSuccess={() => router.refresh()}
            />
            <PairList seriesId={seriesId} pairs={pairs} nameMap={nameMap} onSuccess={() => router.refresh()} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ─── Create form ────────────────────────────────────────────────────────────

function CreatePairForm({
  seriesId,
  members,
  pairedMemberIds,
  onSuccess,
}: {
  seriesId: string;
  members: SeriesMember[];
  pairedMemberIds: Set<string>;
  onSuccess: () => void;
}) {
  const t = useTranslations("club.seriesPartnerPairs");
  const [member1Id, setMember1Id] = useState("");
  const [member2Id, setMember2Id] = useState("");
  const [busy, startTransition] = useTransition();

  // A member already in a pair can't be picked again — server enforces this
  // too, but filtering here avoids a round-trip for the common case.
  const available = members.filter((m) => !pairedMemberIds.has(m.id));
  const nameOf = (id: string) => available.find((m) => m.id === id)?.canonical_name ?? "—";

  const canSubmit = !busy && member1Id !== "" && member2Id !== "" && member1Id !== member2Id;

  function handleSubmit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await addSeriesPartnerPairAction({ seriesId, member1Id, member2Id });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toastAdded"));
      setMember1Id("");
      setMember2Id("");
      onSuccess();
    });
  }

  return (
    <div className="space-y-3 pb-3 border-b">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{t("member1Label")}</Label>
          <Select value={member1Id} onValueChange={(v) => setMember1Id(v ?? "")}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue>{(v: string) => (v ? nameOf(v) : t("selectMember"))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {available.map((m) => (
                <SelectItem key={m.id} value={m.id} disabled={m.id === member2Id}>
                  {m.canonical_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">{t("member2Label")}</Label>
          <Select value={member2Id} onValueChange={(v) => setMember2Id(v ?? "")}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue>{(v: string) => (v ? nameOf(v) : t("selectMember"))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {available.map((m) => (
                <SelectItem key={m.id} value={m.id} disabled={m.id === member1Id}>
                  {m.canonical_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {available.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("noAvailableMembers")}</p>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!canSubmit} onClick={handleSubmit}>
              <Link2 className="h-3.5 w-3.5" />
              {t("addButton")}
            </Button>
          }
        />
        <TooltipContent>{t("addTooltip")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Pair list ──────────────────────────────────────────────────────────────

function PairList({
  seriesId,
  pairs,
  nameMap,
  onSuccess,
}: {
  seriesId: string;
  pairs: SeriesPartnerPair[];
  nameMap: Map<string, string>;
  onSuccess: () => void;
}) {
  const t = useTranslations("club.seriesPartnerPairs");
  if (pairs.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-3">{t("empty")}</p>;
  }

  return (
    <div className="space-y-1">
      {pairs.map((pair) => (
        <PairRow key={pair.id} seriesId={seriesId} pair={pair} nameMap={nameMap} onSuccess={onSuccess} />
      ))}
    </div>
  );
}

function PairRow({
  seriesId,
  pair,
  nameMap,
  onSuccess,
}: {
  seriesId: string;
  pair: SeriesPartnerPair;
  nameMap: Map<string, string>;
  onSuccess: () => void;
}) {
  const t = useTranslations("club.seriesPartnerPairs");
  const [busy, startTransition] = useTransition();

  const name1 = nameMap.get(pair.member1_id) ?? "—";
  const name2 = nameMap.get(pair.member2_id) ?? "—";

  function handleRemove() {
    startTransition(async () => {
      const res = await removeSeriesPartnerPairAction({ seriesId, pairId: pair.id });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toastRemoved"));
      onSuccess();
    });
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="flex-1 text-sm truncate">
        {name1} <span className="text-muted-foreground text-xs">+</span> {name2}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0"
              disabled={busy}
              onClick={handleRemove}
            >
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <TooltipContent>{t("removeTooltip")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
