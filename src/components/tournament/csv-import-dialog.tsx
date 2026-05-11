"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { importTournamentCsvAction } from "@/lib/actions/tournaments";
import type { CsvRow } from "@/lib/actions/tournaments";

// ── CSV parsing ──────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim()); current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text: string): { rows: CsvRow[]; error: string | null } {
  // Strip UTF-8 BOM (Excel)
  const clean = text.replace(/^﻿/, "").trim();
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], error: "ไฟล์ต้องมีอย่างน้อย 1 แถวข้อมูล" };

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s/g, "_"));
  const requiredCols = ["team", "display_name"];
  for (const col of requiredCols) {
    if (!headers.includes(col)) return { rows: [], error: `ไม่พบ column "${col}"` };
  }

  const idx = (col: string) => headers.indexOf(col);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const team = vals[idx("team")] ?? "";
    const display_name = vals[idx("display_name")] ?? "";
    if (!team || !display_name) continue;

    const roleRaw = (vals[idx("role")] ?? "").toLowerCase();
    rows.push({
      team,
      color: idx("color") >= 0 ? vals[idx("color")] ?? "" : "",
      display_name,
      role: roleRaw === "captain" ? "captain" : "member",
      pair_name: idx("pair_name") >= 0 ? vals[idx("pair_name")] ?? "" : "",
    });
  }

  if (!rows.length) return { rows: [], error: "ไม่มีแถวข้อมูลที่ valid" };
  return { rows, error: null };
}

// ── Template download ────────────────────────────────────────────────────────

function downloadTemplate() {
  const csv = [
    "team,color,display_name,role,pair_name",
    "ทีมแดง,#ef4444,ชื่อ นามสกุล,captain,คู่ที่ 1",
    "ทีมแดง,#ef4444,ชื่อ นามสกุล 2,member,คู่ที่ 1",
    "ทีมแดง,#ef4444,ชื่อ นามสกุล 3,member,คู่ที่ 2",
    "ทีมแดง,#ef4444,ชื่อ นามสกุล 4,member,คู่ที่ 2",
    "ทีมเขียว,#22c55e,ชื่อ นามสกุล 5,captain,คู่ A",
    "ทีมเขียว,#22c55e,ชื่อ นามสกุล 6,member,คู่ A",
  ].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "tournament_template.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ── Summary helpers ──────────────────────────────────────────────────────────

function summarize(rows: CsvRow[]) {
  const teams = [...new Set(rows.map((r) => r.team))];
  const pairs = [...new Set(rows.filter((r) => r.pair_name).map((r) => `${r.team}:${r.pair_name}`))];
  return { teamCount: teams.length, playerCount: rows.length, pairCount: pairs.length };
}

// ── Component ────────────────────────────────────────────────────────────────

export function CsvImportDialog({ tournamentId }: { tournamentId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setParseError(null); if (fileRef.current) fileRef.current.value = ""; };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { rows: parsed, error } = parseCsv(text);
      setParseError(error);
      setRows(parsed);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleImport = async () => {
    if (!rows.length) return;
    setPending(true);
    const res = await importTournamentCsvAction(tournamentId, rows);
    setPending(false);
    if ("error" in res) {
      toast.error(res.error);
    } else {
      toast.success(
        `นำเข้าสำเร็จ — ${res.teams} ทีม · ${res.players} คน · ${res.pairs} คู่`
      );
      reset();
      setOpen(false);
    }
  };

  const { teamCount, playerCount, pairCount } = rows.length ? summarize(rows) : { teamCount: 0, playerCount: 0, pairCount: 0 };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger render={
        <Button size="sm" variant="outline">
          <Upload className="h-3.5 w-3.5 mr-1" />
          นำเข้า CSV
        </Button>
      } />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>นำเข้าข้อมูลจาก CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Template download */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">ต้องการ template?</span>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={downloadTemplate}>
              <Download className="h-3 w-3" />
              ดาวน์โหลด template
            </Button>
          </div>

          {/* Column reference */}
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
            <p className="font-medium text-muted-foreground">Columns (header แถวแรก):</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
              <span><code className="text-foreground">team</code> * ชื่อทีม</span>
              <span><code className="text-foreground">display_name</code> * ชื่อผู้เล่น</span>
              <span><code className="text-foreground">color</code> สีทีม (#hex)</span>
              <span><code className="text-foreground">role</code> captain / member</span>
              <span className="col-span-2"><code className="text-foreground">pair_name</code> ชื่อคู่ (2 คนที่ชื่อคู่เดียวกัน = คู่เดียวกัน)</span>
            </div>
          </div>

          {/* File input */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="text-sm"
                onChange={handleFile}
              />
              {rows.length > 0 && (
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={reset}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {parseError && (
              <p className="text-xs text-destructive">{parseError}</p>
            )}
          </div>

          {/* Preview */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">{teamCount} ทีม</Badge>
                <Badge variant="secondary" className="text-xs">{playerCount} คน</Badge>
                {pairCount > 0 && <Badge variant="secondary" className="text-xs">{pairCount} คู่</Badge>}
              </div>

              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">ทีม</th>
                      <th className="text-left px-2 py-1.5 font-medium">ชื่อ</th>
                      <th className="text-left px-2 py-1.5 font-medium">Role</th>
                      <th className="text-left px-2 py-1.5 font-medium">คู่</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.slice(0, 8).map((r, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 truncate max-w-[80px]">
                          {r.color && (
                            <span className="inline-block w-2 h-2 rounded-full mr-1 shrink-0 align-middle" style={{ backgroundColor: r.color }} />
                          )}
                          {r.team}
                        </td>
                        <td className="px-2 py-1 truncate max-w-[100px]">{r.display_name}</td>
                        <td className="px-2 py-1">
                          {r.role === "captain" ? (
                            <Badge className="text-[10px] px-1 py-0">หัวหน้า</Badge>
                          ) : (
                            <span className="text-muted-foreground">สมาชิก</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground truncate max-w-[70px]">{r.pair_name || "—"}</td>
                      </tr>
                    ))}
                    {rows.length > 8 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-1 text-muted-foreground text-center">
                          + {rows.length - 8} แถวอีก
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <Button className="w-full" onClick={handleImport} disabled={pending}>
                {pending ? "กำลังนำเข้า..." : `นำเข้า ${playerCount} คน`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
