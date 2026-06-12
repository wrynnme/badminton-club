"use client";

import { Download, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  generateMatchesCsv,
  generateRosterCsv,
  generatePlayerImportTemplate,
  generatePairImportTemplate,
  downloadCsv,
  type MatchesCsvLabels,
  type RosterCsvLabels,
  type PlayerTemplateSampleLabels,
} from "@/lib/export/csv";
import type { Match, Team, TeamPlayer, PairWithPlayers, MatchUnit } from "@/lib/types";

export function ExportButtons({
  tournamentName,
  tournamentId,
  matches,
  teams,
  pairs,
  matchUnit,
  isOwner = false,
  classCodes = [],
}: {
  tournamentName: string;
  tournamentId: string;
  matches: Match[];
  teams: (Team & { players: TeamPlayer[] })[];
  pairs: PairWithPlayers[];
  matchUnit: MatchUnit;
  isOwner?: boolean;
  /** Competition-mode class codes — when set, the pair template includes a class_code column. */
  classCodes?: string[];
}) {
  const t = useTranslations("tournament");
  const slug = tournamentName.replace(/\s+/g, "_");

  const matchesLabels: MatchesCsvLabels = {
    colMatchNo: t("csv.colMatchNo"),
    colRound: t("csv.colRound"),
    colBracket: t("csv.colBracket"),
    colTeamA: t("csv.colTeamA"),
    colTeamB: t("csv.colTeamB"),
    colPairA: t("csv.colPairA"),
    colPairB: t("csv.colPairB"),
    colGamesA: t("csv.colGamesA"),
    colGamesB: t("csv.colGamesB"),
    colPointsA: t("csv.colPointsA"),
    colPointsB: t("csv.colPointsB"),
    colGameDetail: t("csv.colGameDetail"),
    colWinner: t("csv.colWinner"),
    colStatus: t("csv.colStatus"),
    roundGroup: t("csv.roundGroup"),
    bracketUpper: t("csv.bracketUpper"),
    bracketLower: t("csv.bracketLower"),
    bracketGrandFinal: t("csv.bracketGrandFinal"),
    bracketKnockout: t("csv.bracketKnockout"),
    statusPending: t("csv.statusPending"),
    statusInProgress: t("csv.statusInProgress"),
    statusCompleted: t("csv.statusCompleted"),
    winnerDraw: t("csv.winnerDraw"),
  };

  const rosterLabels: RosterCsvLabels = {
    colTeam: t("csv.rosterColTeam"),
    colColor: t("csv.rosterColColor"),
    colPlayerName: t("csv.rosterColPlayerName"),
    colRole: t("csv.rosterColRole"),
    colPairName: t("csv.rosterColPairName"),
    roleCaptain: t("csv.rosterRoleCaptain"),
    roleMember: t("csv.rosterRoleMember"),
  };

  const playerTemplateLabels: PlayerTemplateSampleLabels = {
    sampleTeamRed: t("csv.sampleTeamRed"),
    sampleTeamGreen: t("csv.sampleTeamGreen"),
    sampleNames: [
      t("csv.sampleName1"),
      t("csv.sampleName2"),
      t("csv.sampleName3"),
      t("csv.sampleName4"),
      t("csv.sampleName5"),
      t("csv.sampleName6"),
    ],
  };

  const exportMatches = () => {
    const csv = generateMatchesCsv(matches, teams, pairs, matchUnit, matchesLabels);
    downloadCsv(csv, `${slug}_matches.csv`);
  };

  const exportRoster = () => {
    const csv = generateRosterCsv(teams, pairs, rosterLabels);
    downloadCsv(csv, `${slug}_roster.csv`);
  };

  const exportPairTemplate = () => {
    const csv = generatePairImportTemplate(teams, classCodes);
    downloadCsv(csv, `${slug}_pair_template.csv`);
  };

  const exportPlayerTemplate = () => {
    const csv = generatePlayerImportTemplate(playerTemplateLabels);
    downloadCsv(csv, "player_import_template.csv");
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t("exportButtons.export")}</span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportMatches}>
          <Download className="h-3 w-3" />{t("exportButtons.matches")}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportRoster}>
          <Download className="h-3 w-3" />{t("exportButtons.roster")}
        </Button>
      </div>
      {isOwner && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">{t("exportButtons.template")}</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={exportPlayerTemplate}>
            <Download className="h-3 w-3" />{t("exportButtons.players")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={exportPairTemplate}>
            <Download className="h-3 w-3" />{t("exportButtons.pairs")}
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t("exportButtons.print")}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => window.open(`/tournaments/${tournamentId}/print/matches`, "_blank")}
        >
          <Printer className="h-3 w-3" />{t("exportButtons.matches")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => window.open(`/tournaments/${tournamentId}/print/roster`, "_blank")}
        >
          <Printer className="h-3 w-3" />{t("exportButtons.roster")}
        </Button>
      </div>
    </div>
  );
}
