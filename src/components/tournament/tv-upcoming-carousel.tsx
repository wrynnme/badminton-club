"use client";

import { useEffect, useState } from "react";
import { TvMatchCard } from "@/components/tournament/tv-match-card";
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

  const [active, setActive] = useState(0);

  // Clamp index if pages shrinks
  useEffect(() => {
    if (active >= pages.length && pages.length > 0) {
      setActive(0);
    }
  }, [pages.length, active]);

  // Cycle when more than one page
  useEffect(() => {
    if (pages.length <= 1) return;
    const id = setInterval(() => {
      setActive((prev) => (prev + 1) % pages.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [pages.length, intervalMs]);

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

  const current = pages[Math.min(active, pages.length - 1)];

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="shrink-0 flex items-center justify-between pb-2">
        <h2 className="text-xl lg:text-2xl 2xl:text-3xl font-bold">{current.title}</h2>
        {pages.length > 1 && (
          <div className="flex items-center gap-2">
            {pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`ไปหน้า ${p.title}`}
                aria-current={i === active}
                className={`w-3 h-3 lg:w-3.5 lg:h-3.5 rounded-full transition-colors cursor-pointer hover:bg-foreground/70 ${
                  i === active ? "bg-foreground" : "bg-muted"
                }`}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div key={current.id} className="animate-in fade-in duration-300 h-full grid grid-rows-6 gap-2">
          {current.matches.map((m) => (
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
