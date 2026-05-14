"use client";

import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateMatchesCsv, generateRosterCsv, generatePlayerImportTemplate, generatePairImportTemplate, downloadCsv } from "@/lib/export/csv";
import type { Match, Team, TeamPlayer, PairWithPlayers, MatchUnit } from "@/lib/types";

export function ExportButtons({
  tournamentName,
  tournamentId,
  matches,
  teams,
  pairs,
  matchUnit,
  isOwner = false,
}: {
  tournamentName: string;
  tournamentId: string;
  matches: Match[];
  teams: (Team & { players: TeamPlayer[] })[];
  pairs: PairWithPlayers[];
  matchUnit: MatchUnit;
  isOwner?: boolean;
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

  const exportPairTemplate = () => {
    const csv = generatePairImportTemplate(teams);
    downloadCsv(csv, `${slug}_pair_template.csv`);
  };

  const exportPlayerTemplate = () => {
    const csv = generatePlayerImportTemplate();
    downloadCsv(csv, "player_import_template.csv");
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">Export:</span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportMatches}>
          <Download className="h-3 w-3" />ผลแข่งขัน
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportRoster}>
          <Download className="h-3 w-3" />รายชื่อ
        </Button>
      </div>
      {isOwner && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Template:</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={exportPlayerTemplate}>
            <Download className="h-3 w-3" />ผู้เล่น
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={exportPairTemplate}>
            <Download className="h-3 w-3" />จับคู่
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">พิมพ์:</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => window.open(`/tournaments/${tournamentId}/print/matches`, "_blank")}
        >
          <Printer className="h-3 w-3" />ผลแข่งขัน
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => window.open(`/tournaments/${tournamentId}/print/roster`, "_blank")}
        >
          <Printer className="h-3 w-3" />รายชื่อ
        </Button>
      </div>
    </div>
  );
}
