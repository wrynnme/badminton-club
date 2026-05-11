"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Download } from "lucide-react";
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
import { importPlayersCsvAction, importPairsCsvAction } from "@/lib/actions/tournaments";
import type { PlayerCsvRow, PairCsvRow } from "@/lib/actions/tournaments";

// ── CSV parser ───────────────────────────────────────────────────────────────

function parseLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === "," && !inQ) { result.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  result.push(cur.trim());
  return result;
}

function parseFile<T>(
  text: string,
  required: string[],
  mapper: (headers: string[], vals: string[]) => T | null
): { rows: T[]; error: string | null } {
  const clean = text.replace(/^﻿/, "").trim();
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], error: "ต้องมีอย่างน้อย 1 แถวข้อมูล" };
  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/\s/g, "_"));
  for (const c of required) {
    if (!headers.includes(c)) return { rows: [], error: `ไม่พบ column "${c}"` };
  }
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const r = mapper(headers, vals);
    if (r) rows.push(r);
  }
  if (!rows.length) return { rows: [], error: "ไม่มีแถวที่ valid" };
  return { rows, error: null };
}

function idx(headers: string[], col: string, vals: string[]) {
  const i = headers.indexOf(col);
  return i >= 0 ? vals[i] ?? "" : "";
}

function parsePlayerCsv(text: string) {
  return parseFile<PlayerCsvRow>(
    text,
    ["team", "id_player", "display_name"],
    (h, v) => {
      const team = idx(h, "team", v);
      const csv_id = idx(h, "id_player", v);
      const display_name = idx(h, "display_name", v);
      if (!team || !csv_id || !display_name) return null;
      const roleRaw = idx(h, "role", v).toLowerCase();
      return { team, color: idx(h, "color", v), csv_id, display_name, role: roleRaw === "captain" ? "captain" : "member", level: idx(h, "level", v) };
    }
  );
}

function parsePairCsv(text: string) {
  return parseFile<PairCsvRow>(
    text,
    ["id_player", "pair_name"],
    (h, v) => {
      const csv_id = idx(h, "id_player", v);
      const pair_name = idx(h, "pair_name", v);
      if (!csv_id || !pair_name) return null;
      return { csv_id, pair_name };
    }
  );
}

// ── Template downloads ────────────────────────────────────────────────────────

function download(csv: string, filename: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const PLAYER_TEMPLATE = [
  "team,color,id_player,display_name,role,level",
  "ทีมแดง,#ef4444,R1-1a,ชื่อ นามสกุล,captain,A",
  "ทีมแดง,#ef4444,R1-1b,ชื่อ นามสกุล 2,member,B",
  "ทีมแดง,#ef4444,R1-2a,ชื่อ นามสกุล 3,member,B",
  "ทีมแดง,#ef4444,R1-2b,ชื่อ นามสกุล 4,member,C",
  "ทีมเขียว,#22c55e,G1-1a,ชื่อ นามสกุล 5,member,A",
  "ทีมเขียว,#22c55e,G1-1b,ชื่อ นามสกุล 6,member,B",
].join("\n");

const PAIR_TEMPLATE = [
  "id_player,pair_name",
  "R1-1a,คู่ที่ 1",
  "R1-1b,คู่ที่ 1",
  "R1-2a,คู่ที่ 2",
  "R1-2b,คู่ที่ 2",
  "G1-1a,G1-คู่ 1",
  "G1-1b,G1-คู่ 1",
].join("\n");

// ── Subcomponent: file picker with preview ────────────────────────────────────

function FilePicker<T>({
  accept,
  onParsed,
  parseRow,
  previewCols,
}: {
  accept: string;
  onParsed: (rows: T[]) => void;
  parseRow: (text: string) => { rows: T[]; error: string | null };
  previewCols: { key: keyof T; label: string }[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows: parsed, error: err } = parseRow(ev.target?.result as string);
      setError(err);
      setRows(parsed);
      onParsed(parsed);
    };
    reader.readAsText(file, "utf-8");
  };

  return (
    <div className="space-y-2">
      <Input ref={fileRef} type="file" accept={accept} className="text-sm" onChange={handleFile} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {rows.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>{previewCols.map((c) => <th key={String(c.key)} className="text-left px-2 py-1.5 font-medium">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {rows.slice(0, 6).map((r, i) => (
                <tr key={i}>{previewCols.map((c) => <td key={String(c.key)} className="px-2 py-1 truncate max-w-[100px]">{String(r[c.key] ?? "")}</td>)}</tr>
              ))}
              {rows.length > 6 && (
                <tr><td colSpan={previewCols.length} className="px-2 py-1 text-muted-foreground text-center">+ {rows.length - 6} แถวอีก</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

type Mode = "players" | "pairs";

export function CsvImportDialog({ tournamentId }: { tournamentId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("players");
  const [playerRows, setPlayerRows] = useState<PlayerCsvRow[]>([]);
  const [pairRows, setPairRows] = useState<PairCsvRow[]>([]);
  const [pending, setPending] = useState(false);

  const reset = () => { setPlayerRows([]); setPairRows([]); };

  const handleImportPlayers = async () => {
    if (!playerRows.length) return;
    setPending(true);
    const res = await importPlayersCsvAction(tournamentId, playerRows);
    setPending(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`ผู้เล่น: สร้าง ${res.created} · อัพเดท ${res.updated} · ทีมใหม่ ${res.teams}`);
    reset(); setOpen(false);
  };

  const handleImportPairs = async () => {
    if (!pairRows.length) return;
    setPending(true);
    const res = await importPairsCsvAction(tournamentId, pairRows);
    setPending(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`สร้าง ${res.pairs} คู่${res.skipped ? ` · ข้าม ${res.skipped}` : ""}`);
    reset(); setOpen(false);
  };

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
          {/* Mode toggle */}
          <div className="flex gap-2">
            {(["players", "pairs"] as Mode[]).map((m) => (
              <Button key={m} size="sm" variant={mode === m ? "default" : "outline"}
                className="flex-1" onClick={() => setMode(m)}>
                {m === "players" ? "1. ผู้เล่น" : "2. จับคู่"}
              </Button>
            ))}
          </div>

          {mode === "players" && (
            <>
              <div className="flex items-center justify-between">
                <div className="rounded-md border bg-muted/30 p-2.5 text-xs flex-1 space-y-0.5">
                  <p className="font-medium text-muted-foreground">Columns:</p>
                  <p><code className="text-foreground">team</code> · <code className="text-foreground">color</code> · <code className="text-foreground font-bold">id_player</code> * · <code className="text-foreground">display_name</code> * · <code className="text-foreground">role</code> · <code className="text-foreground">level</code></p>
                  <p className="text-muted-foreground">id_player = ID คงที่ (ใช้ lookup ตอนจับคู่)</p>
                </div>
                <Button size="sm" variant="ghost" className="ml-2 h-7 text-xs gap-1 shrink-0" onClick={() => download(PLAYER_TEMPLATE, "players_template.csv")}>
                  <Download className="h-3 w-3" />Template
                </Button>
              </div>

              <FilePicker<PlayerCsvRow>
                accept=".csv,text/csv"
                onParsed={setPlayerRows}
                parseRow={parsePlayerCsv}
                previewCols={[
                  { key: "team", label: "ทีม" },
                  { key: "csv_id", label: "id_player" },
                  { key: "display_name", label: "ชื่อ" },
                  { key: "role", label: "Role" },
                  { key: "level", label: "Level" },
                ]}
              />

              {playerRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Badge variant="secondary" className="text-xs">{new Set(playerRows.map((r) => r.team)).size} ทีม</Badge>
                    <Badge variant="secondary" className="text-xs">{playerRows.length} คน</Badge>
                  </div>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    ⚠ id_player ซ้ำ = อัพเดทชื่อ/role, id_player ใหม่ = สร้างผู้เล่นใหม่
                  </p>
                  <Button className="w-full" onClick={handleImportPlayers} disabled={pending}>
                    {pending ? "กำลังนำเข้า..." : `นำเข้า ${playerRows.length} คน`}
                  </Button>
                </div>
              )}
            </>
          )}

          {mode === "pairs" && (
            <>
              <div className="flex items-center justify-between">
                <div className="rounded-md border bg-muted/30 p-2.5 text-xs flex-1 space-y-0.5">
                  <p className="font-medium text-muted-foreground">Columns:</p>
                  <p><code className="text-foreground font-bold">id_player</code> * · <code className="text-foreground font-bold">pair_name</code> *</p>
                  <p className="text-muted-foreground">2 แถวที่ pair_name เดียวกัน = 1 คู่ (ต้องอยู่ทีมเดียวกัน)</p>
                </div>
                <Button size="sm" variant="ghost" className="ml-2 h-7 text-xs gap-1 shrink-0" onClick={() => download(PAIR_TEMPLATE, "pairs_template.csv")}>
                  <Download className="h-3 w-3" />Template
                </Button>
              </div>

              <FilePicker<PairCsvRow>
                accept=".csv,text/csv"
                onParsed={setPairRows}
                parseRow={parsePairCsv}
                previewCols={[
                  { key: "csv_id", label: "id_player" },
                  { key: "pair_name", label: "pair_name" },
                ]}
              />

              {pairRows.length > 0 && (
                <div className="space-y-2">
                  <Badge variant="secondary" className="text-xs">
                    {new Set(pairRows.map((r) => r.pair_name)).size} คู่ ({pairRows.length} แถว)
                  </Badge>
                  <Button className="w-full" onClick={handleImportPairs} disabled={pending}>
                    {pending ? "กำลังนำเข้า..." : `สร้างคู่จาก ${pairRows.length} แถว`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
