"use client";

import { TvMatchCard } from "@/components/tournament/tv-match-card";
import { TvCarouselDots, useCarousel } from "@/components/tournament/tv-carousel-shell";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

type UpcomingPage = {
  id: "in_progress" | "pending";
  title: string;
  matches: Match[];
};

type Props = {
  inProgress: Match[];
  pending: Match[];
  competitorById: Map<string, Competitor>;
  unit: "team" | "pair";
  intervalMs?: number;
};

export function TvUpcomingCarousel({
  inProgress,
  pending,
  competitorById,
  unit,
  intervalMs = 8000,
}: Props) {
  const pages: UpcomingPage[] = (
    [
      { id: "in_progress", title: "กำลังเล่น", matches: inProgress },
      { id: "pending", title: "ถัดไป", matches: pending },
    ] as UpcomingPage[]
  ).filter((p) => p.matches.length > 0);

  const { active, setActive } = useCarousel(pages.length, intervalMs);

  if (pages.length === 0) {
    return (
      <div className="h-full overflow-hidden flex flex-col">
        <div className="shrink-0 flex items-center justify-between pb-2">
          <h2 className="text-xl lg:text-2xl 2xl:text-3xl font-bold">กำลังเล่น / ถัดไป</h2>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <p className="text-lg lg:text-2xl 2xl:text-3xl text-muted-foreground">ไม่มีคิวค้าง</p>
        </div>
      </div>
    );
  }

  const current = pages[active];
  // Defensive cap: TV layout is designed for at most 6 visible rows;
  // anything beyond would overflow the fixed-height container. Source
  // arrays are usually already sliced upstream — this is belt-and-braces.
  const MAX_ROWS = 6;
  const visibleMatches = current.matches.slice(0, MAX_ROWS);
  const rowCount = Math.max(1, visibleMatches.length);

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="shrink-0 flex items-center justify-between pb-2">
        <h2 className="text-xl lg:text-2xl 2xl:text-3xl font-bold">{current.title}</h2>
        <TvCarouselDots
          count={pages.length}
          active={active}
          onSelect={setActive}
          labels={(i) => `ไปหน้า ${pages[i]?.title ?? i + 1}`}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          key={current.id}
          className="animate-in fade-in duration-300 h-full grid gap-2"
          style={{
            gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))`,
          }}
        >
          {visibleMatches.map((m) => (
            <div key={m.id} className="min-h-0 overflow-hidden">
              <TvMatchCard
                match={m}
                competitorById={competitorById}
                unit={unit}
                fillHeight
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
