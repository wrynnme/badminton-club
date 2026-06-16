"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updatePrizeTemplateAction } from "@/lib/actions/tournaments";
import type { PrizeTemplateEntry } from "@/lib/tournament/prizes";

type Props = {
  tournamentId: string;
  initial: PrizeTemplateEntry[];
};

type Row = PrizeTemplateEntry & { _key: number };

let _keyCounter = 0;
function makeKey() {
  return ++_keyCounter;
}

function toRows(entries: PrizeTemplateEntry[]): Row[] {
  return entries.map((e) => ({ ...e, _key: makeKey() }));
}

export function PrizeTemplateEditor({ tournamentId, initial }: Props) {
  const t = useTranslations("tournament");
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [saving, startSave] = useTransition();

  const addRow = () => {
    const maxRank = rows.reduce((m, r) => Math.max(m, r.rank), 0);
    setRows((prev) => [
      ...prev,
      { rank: maxRank + 1, label: "", cash: 0, trophy: false, _key: makeKey() },
    ]);
  };

  const removeRow = (key: number) => {
    setRows((prev) => prev.filter((r) => r._key !== key));
  };

  const updateRow = (key: number, patch: Partial<PrizeTemplateEntry>) => {
    setRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, ...patch } : r))
    );
  };

  const save = () => {
    startSave(async () => {
      const payload: PrizeTemplateEntry[] = rows.map(({ _key: _k, ...rest }) => ({
        ...rest,
        rank: Number(rest.rank) || 0,
        cash: Number(rest.cash) || 0,
      }));
      const res = await updatePrizeTemplateAction(tournamentId, payload);
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("prizes.toastSaved"));
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {t("prizes.configTitle")}
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("prizes.configHint")}</p>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-16 font-medium h-8">{t("prizes.rankCol")}</TableHead>
                <TableHead className="font-medium h-8">{t("prizes.labelCol")}</TableHead>
                <TableHead className="w-36 font-medium h-8">{t("prizes.cashCol")}</TableHead>
                <TableHead className="w-16 text-center font-medium h-8">{t("prizes.trophyCol")}</TableHead>
                <TableHead className="w-8 h-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row._key} className="hover:bg-transparent">
                  <TableCell className="py-1.5 pr-2">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={row.rank}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n)) updateRow(row._key, { rank: Math.min(99, Math.max(1, n)) });
                      }}
                      className="h-8 w-14 text-sm"
                      disabled={saving}
                    />
                  </TableCell>
                  <TableCell className="py-1.5 pr-2">
                    <Input
                      type="text"
                      value={row.label}
                      maxLength={60}
                      onChange={(e) => updateRow(row._key, { label: e.target.value })}
                      placeholder={t("prizes.labelCol")}
                      className="h-8 text-sm"
                      disabled={saving}
                    />
                  </TableCell>
                  <TableCell className="py-1.5 pr-2">
                    <Input
                      type="number"
                      min={0}
                      max={100_000_000}
                      value={row.cash}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n)) updateRow(row._key, { cash: Math.min(100_000_000, Math.max(0, n)) });
                      }}
                      className="h-8 text-sm"
                      disabled={saving}
                    />
                  </TableCell>
                  <TableCell className="py-1.5 pr-2 text-center">
                    <Checkbox
                      checked={row.trophy}
                      onCheckedChange={(checked) =>
                        updateRow(row._key, { trophy: checked === true })
                      }
                      disabled={saving}
                      aria-label={t("prizes.trophyCol")}
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("prizes.removeRow")}
                            className="text-destructive hover:text-destructive"
                            onClick={() => removeRow(row._key)}
                            disabled={saving}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <TooltipContent>{t("prizes.tooltipRemove", { rank: row.rank })}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex gap-2 pt-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addRow}
                  disabled={saving}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t("prizes.addPrize")}
                </Button>
              }
            />
            <TooltipContent>{t("prizes.tooltipAdd")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  onClick={save}
                  disabled={saving || rows.some((r) => !r.label.trim())}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : null}
                  {t("prizes.save")}
                </Button>
              }
            />
            <TooltipContent>{t("prizes.tooltipSave")}</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}
