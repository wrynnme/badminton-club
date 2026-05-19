"use client";

import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MatchRow } from "@/components/tournament/match-row";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

const VIRTUALIZE_THRESHOLD = 50;

type Props = {
  matches: Match[];
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  isOwner: boolean;
  unit: "team" | "pair";
  size?: "compact" | "comfortable";
};

export function MatchList(props: Props) {
  if (props.matches.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="divide-y">
        {props.matches.map((m) => (
          <MatchRow
            key={m.id}
            match={m}
            competitorById={props.competitorById}
            tournamentId={props.tournamentId}
            isOwner={props.isOwner}
            unit={props.unit}
            size={props.size}
          />
        ))}
      </div>
    );
  }
  return <VirtualMatchList {...props} />;
}

function VirtualMatchList({
  matches,
  competitorById,
  tournamentId,
  isOwner,
  unit,
  size,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Force re-render after first paint so virtualizer sees parentRef.current.
  // Without this, getVirtualItems() returns [] on the initial render.
  const [, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  const estimate = size === "comfortable" ? 76 : 60;

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimate,
    overscan: 8,
  });

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className="max-h-[600px] overflow-auto"
    >
      <div style={{ height: totalSize, position: "relative", width: "100%" }}>
        {items.map((vi) => {
          const m = matches[vi.index];
          return (
            <div
              key={m.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
              className="border-b last:border-b-0"
            >
              <MatchRow
                match={m}
                competitorById={competitorById}
                tournamentId={tournamentId}
                isOwner={isOwner}
                unit={unit}
                size={size}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
