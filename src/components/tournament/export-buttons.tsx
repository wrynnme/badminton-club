"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateMatchesCsv, generateRosterCsv, downloadCsv } from "@/lib/export/csv";
import type { Match, Team, TeamPlayer, PairWithPlayers, MatchUnit } from "@/lib/types";

export function ExportButtons({
  tournamentName,
  matches,
  teams,
  pairs,
  matchUnit,
}: {
  tournamentName: string;
  matches: Match[];
  teams: (Team & { players: TeamPlayer[] })[];
  pairs: PairWithPlayers[];
  matchUnit: MatchUnit;
}) {
  const slug = tournamentName.replace(/\s+/g, "_");

  const exportMatches = () => {
    const csv = generateMatchesCsv(matches, teams, pairs, matchUnit);
    downloadCsv(csv, `${slug}_matches.csv`);
  };

  const exportRoster = () => {
    const csv = generateRosterCsv(teams, pairs);
    downloadCsv(csv, `${slug}_roster.csv`);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground shrink-0">Export:</span>
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportMatches}>
        <Download className="h-3 w-3" />
        ผลแข่งขัน
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportRoster}>
        <Download className="h-3 w-3" />
        รายชื่อ
      </Button>
    </div>
  );
}
