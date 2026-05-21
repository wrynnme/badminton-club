"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export type ChartRow = {
  id: string;
  name: string;
  color?: string | null;
  pts: number;
};

export type TableRow = {
  competitorId: string;
  name: string;
  color?: string | null;
  played: number;
  leaguePoints: number;
};

export type StandingsPage =
  | { kind: "table"; id: string; title: string; rows: TableRow[] }
  | { kind: "chart"; id: string; title: string; rows: ChartRow[] };

type Props = {
  pages: StandingsPage[];
  intervalMs?: number;
};

const chartConfig = { pts: { label: "คะแนน" } } satisfies ChartConfig;

function TvStandingsChart({ rows }: { rows: ChartRow[] }) {
  if (rows.length === 0) {
    return <p className="text-base lg:text-lg text-muted-foreground">ยังไม่มีผล</p>;
  }
  const data = rows.map((r) => ({
    name: r.name,
    pts: r.pts,
    fill: r.color ?? "#94a3b8",
  }));
  const chartHeight = Math.min(rows.length * 28 + 16, 240);
  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      <ChartContainer
        config={chartConfig}
        className="w-full aspect-auto"
        style={{ aspectRatio: "auto", height: chartHeight }}
      >
        <BarChart
          accessibilityLayer
          data={data}
          layout="vertical"
          margin={{ top: 2, right: 24, bottom: 2, left: 4 }}
          barCategoryGap={4}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={72}
            tick={{ fontSize: 11 }}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
          <Bar dataKey="pts" radius={3} barSize={16}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
            <LabelList
              dataKey="pts"
              position="right"
              offset={4}
              className="fill-foreground"
              fontSize={11}
              fontWeight={700}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export function TvStandingsCarousel({ pages, intervalMs = 8000 }: Props) {
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
        <h2 className="shrink-0 text-xl lg:text-2xl 2xl:text-3xl font-bold pb-2">อันดับ</h2>
        <div className="flex-1 min-h-0 overflow-hidden rounded-xl border bg-card p-3 lg:p-4">
          <p className="text-base lg:text-lg text-muted-foreground">ยังไม่มีผล</p>
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
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border bg-card p-3 lg:p-4">
        <div key={current.id} className="animate-in fade-in duration-300 h-full">
          {current.kind === "chart" ? (
            <TvStandingsChart rows={current.rows} />
          ) : (
            <table className="w-full text-base lg:text-lg 2xl:text-xl">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1 font-normal w-8">#</th>
                  <th className="py-1 font-normal">ชื่อ</th>
                  <th className="py-1 font-normal text-center w-10">P</th>
                  <th className="py-1 font-normal text-center w-12">Pts</th>
                </tr>
              </thead>
              <tbody>
                {current.rows.map((row, i) => (
                  <tr
                    key={row.competitorId}
                    className={i === 0 ? "font-bold text-green-600 dark:text-green-400" : ""}
                  >
                    <td className="py-1 tabular-nums">{i + 1}</td>
                    <td className="py-1 truncate max-w-[8rem] lg:max-w-[10rem] 2xl:max-w-[14rem]">
                      <div className="flex items-center gap-1.5">
                        {row.color && (
                          <span
                            className="w-2.5 h-2.5 lg:w-3 lg:h-3 rounded-full shrink-0"
                            style={{ backgroundColor: row.color }}
                          />
                        )}
                        <span className="truncate">{row.name}</span>
                      </div>
                    </td>
                    <td className="py-1 text-center tabular-nums">{row.played}</td>
                    <td className="py-1 text-center tabular-nums font-semibold">{row.leaguePoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
