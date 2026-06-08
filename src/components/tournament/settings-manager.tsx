"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, ListOrdered, EyeOff, Loader2, Tv, Swords } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateTournamentSettingsAction } from "@/lib/actions/tournaments";
import {
  parseSettings,
  type TournamentSettings,
  type LineNotifyFlags,
} from "@/lib/tournament/settings";
import { MATCH_FORMAT_LABEL_TH } from "@/lib/tournament/match-format";
import type { MatchFormat } from "@/lib/types";
import { divisionCount } from "@/lib/tournament/divisions";

const DEBOUNCE_MS = 500;

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div className="space-y-0.5 leading-tight">
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {label}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

function NumberRow({
  id,
  label,
  description,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="space-y-0.5 leading-tight min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-20 h-8 text-sm shrink-0"
      />
    </div>
  );
}

function DivisionPriorityRow({
  nDivisions,
  value,
  onChange,
}: {
  nDivisions: number;
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const [raw, setRaw] = useState(() => value.join(","));
  const [error, setError] = useState("");

  // Keep raw in sync when parent resets
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setRaw(value.join(","));
    }
  }, [value]);

  function handleBlur() {
    if (raw.trim() === "") {
      setError("");
      onChange([]);
      return;
    }
    const parts = raw.split(",").map((s) => parseInt(s.trim(), 10));
    const valid = parts.filter((n) => Number.isFinite(n) && n >= 1 && n <= nDivisions);
    const deduped = [...new Set(valid)];
    if (deduped.length === 0 && raw.trim() !== "") {
      setError(`ใส่เลข 1–${nDivisions} คั่นด้วยจุลภาค เช่น 1,2,3`);
      return;
    }
    setError("");
    setRaw(deduped.join(","));
    onChange(deduped);
  }

  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="division-priority" className="text-sm font-medium">ลำดับ Division</Label>
          <p className="text-xs text-muted-foreground">
            ลำดับ Div ที่จะลงสนามก่อน (เช่น 2,1) — ว่างไว้ = 1..{nDivisions}
          </p>
        </div>
        <Input
          id="division-priority"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={handleBlur}
          placeholder={`1,2,...,${nDivisions}`}
          className="w-36 h-8 text-xs font-mono"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function SettingsManager({
  tournamentId,
  initialSettings,
  pairDivisionThresholds = [],
}: {
  tournamentId: string;
  initialSettings: unknown;
  pairDivisionThresholds?: number[];
}) {
  const [settings, setSettings] = useState<TournamentSettings>(() =>
    parseSettings(initialSettings),
  );
  const [pending, startTransition] = useTransition();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  const pendingPatchRef = useRef<Partial<TournamentSettings> | null>(null);

  async function flush(patch: Partial<TournamentSettings>) {
    if (inFlightRef.current) await inFlightRef.current;
    const p = updateTournamentSettingsAction(tournamentId, patch);
    inFlightRef.current = p;
    const res = await p;
    inFlightRef.current = null;
    pendingPatchRef.current = null;
    if (res && "error" in res && res.error) {
      toast.error(res.error);
    }
  }

  // Auto-save debounced. Serialize via inFlightRef so rapid toggles don't interleave.
  // On unmount: flush any pending patch fire-and-forget so navigating away mid-debounce
  // doesn't drop the change.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      const patch = pendingPatchRef.current;
      if (patch) {
        void flush(patch);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(patch: Partial<TournamentSettings>, next: TournamentSettings) {
    setSettings(next);
    // Merge with any queued patch so unmount-flush captures every toggle since last save.
    pendingPatchRef.current = {
      ...(pendingPatchRef.current ?? {}),
      ...patch,
      ...(patch.line_notify
        ? { line_notify: { ...(pendingPatchRef.current?.line_notify ?? {}), ...patch.line_notify } }
        : {}),
    };
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const queued = pendingPatchRef.current;
      if (!queued) return;
      startTransition(() => flush(queued));
    }, DEBOUNCE_MS);
  }

  function updateNotify(key: keyof LineNotifyFlags, value: boolean) {
    const nextNotify = { ...settings.line_notify, [key]: value };
    commit(
      { line_notify: nextNotify },
      { ...settings, line_notify: nextNotify },
    );
  }

  function update<K extends keyof TournamentSettings>(key: K, value: TournamentSettings[K]) {
    commit({ [key]: value } as Partial<TournamentSettings>, { ...settings, [key]: value });
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">ฟีเจอร์</CardTitle>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Bell className="h-3.5 w-3.5" /> การแจ้งเตือน LINE
          </h3>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <ToggleRow
              id="line-start"
              label="เรียกแมตช์"
              description="เมื่อกด เริ่ม"
              checked={settings.line_notify.start}
              onChange={(v) => updateNotify("start", v)}
            />
            <ToggleRow
              id="line-score"
              label="บันทึกผล"
              description="เมื่อบันทึกคะแนน"
              checked={settings.line_notify.score}
              onChange={(v) => updateNotify("score", v)}
            />
            <ToggleRow
              id="line-bracket"
              label="สร้างสาย"
              description="เมื่อสร้างสายน็อคเอ้า"
              checked={settings.line_notify.bracket}
              onChange={(v) => updateNotify("bracket", v)}
            />
            <ToggleRow
              id="line-status"
              label="เปลี่ยนสถานะ"
              description="เมื่อเปลี่ยน draft/ongoing/completed"
              checked={settings.line_notify.status}
              onChange={(v) => updateNotify("status", v)}
            />
          </div>
        </section>

        <section className="space-y-1 border-t pt-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ListOrdered className="h-3.5 w-3.5" /> การจัดคิว
          </h3>
          <NumberRow
            id="auto-rotate-gap"
            label="Gap พักผู้เล่น"
            description="auto-rotate จะหลีกเลี่ยงผู้เล่นใน N แมตช์ล่าสุด"
            value={settings.auto_rotate_rest_gap}
            min={0}
            max={5}
            onChange={(v) => update("auto_rotate_rest_gap", v)}
          />
          <NumberRow
            id="cooldown"
            label="Cooldown ระหว่างแมตช์ (นาที)"
            description="0 = ปิด; กันการเรียกแมตช์ถี่เกิน"
            value={settings.match_cooldown_minutes}
            min={0}
            max={30}
            onChange={(v) => update("match_cooldown_minutes", v)}
          />
          <ToggleRow
            id="court-strict"
            label="บังคับเลือกสนามไม่ซ้อน"
            description="เปิด = บล็อกตอนเลือกสนามที่ถูกใช้อยู่. ปิด = อนุญาตให้เลือกซ้อน แต่กดเริ่มไม่ได้ถ้าสนามไม่ว่าง"
            checked={settings.court_strict}
            onChange={(v) => update("court_strict", v)}
          />
          <ToggleRow
            id="auto-advance"
            label="Auto-advance แมตช์ถัดไป"
            description="หลังบันทึกผล → ดึง pending #1 ขึ้นแข่ง (สืบสนามเดิม)"
            checked={settings.auto_advance_next}
            onChange={(v) => update("auto_advance_next", v)}
          />
          <ToggleRow
            id="require_court_to_start"
            label="ต้องเลือกสนามก่อนเริ่มแมตช์"
            description="บล็อกปุ่ม 'เริ่ม' ในแท็บตารางคิวจนกว่าจะเลือกสนาม"
            checked={settings.require_court_to_start}
            onChange={(v) => commit({ require_court_to_start: v }, { ...settings, require_court_to_start: v })}
          />
          <ToggleRow
            id="require_checkin"
            label="ต้องเช็คอินก่อนเริ่มแมตช์"
            description="ผู้เล่นทุกคนในแมตช์ต้องเช็คอินก่อน กดเริ่มถึงไม่ติด (แท็บทีม)"
            checked={settings.require_checkin}
            onChange={(v) => commit({ require_checkin: v }, { ...settings, require_checkin: v })}
          />
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="queue-division-order" className="text-sm">ลำดับ Division ใน auto-rotate</Label>
              <p className="text-xs text-muted-foreground">
                กำหนดว่า Division ไหนแข่งก่อนในตารางคิว
              </p>
            </div>
            <Select
              value={settings.queue_division_order}
              onValueChange={(v) => update("queue_division_order", v as TournamentSettings["queue_division_order"])}
            >
              <SelectTrigger id="queue-division-order" className="w-36 h-8 text-xs">
                <SelectValue>
                  {(value) =>
                    value === "interleaved" ? "สลับ" : value === "sequential" ? "ตามลำดับ" : value === "chunked" ? "เป็นชุด" : ""
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interleaved">สลับ</SelectItem>
                <SelectItem value="sequential">ตามลำดับ</SelectItem>
                <SelectItem value="chunked">เป็นชุด</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {settings.queue_division_order !== "interleaved" && (
            <DivisionPriorityRow
              nDivisions={divisionCount(pairDivisionThresholds)}
              value={settings.queue_division_priority}
              onChange={(v) => update("queue_division_priority", v)}
            />
          )}
          {settings.queue_division_order === "chunked" && (
            <NumberRow
              id="chunk-size"
              label="ขนาด chunk (N)"
              description="แมตช์ต่อชุดเมื่อสลับ chunked"
              value={settings.queue_chunk_size}
              min={1}
              max={50}
              onChange={(v) => update("queue_chunk_size", v)}
            />
          )}
          <ToggleRow
            id="manual-after-bracket"
            label="Manual match หลังสร้างสาย (pair mode)"
            description="ปิดเพื่อล็อกตารางหลังเข้าน็อคเอ้า"
            checked={settings.allow_manual_match_after_bracket}
            onChange={(v) => update("allow_manual_match_after_bracket", v)}
          />
        </section>

        <section className="space-y-1 border-t pt-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Swords className="h-3.5 w-3.5" /> การแข่งขัน
          </h3>
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="default-match-format" className="text-sm">รูปแบบแมตช์เริ่มต้น</Label>
              <p className="text-xs text-muted-foreground">
                ใช้เมื่อ class ไม่ได้กำหนดรูปแบบเอง (sports_day หรือ class ที่ไม่ระบุ)
              </p>
            </div>
            <Select
              value={settings.default_match_format}
              onValueChange={(v) => update("default_match_format", v as MatchFormat)}
            >
              <SelectTrigger id="default-match-format" className="w-44 h-8 text-xs">
                <SelectValue>
                  {(value: string) => MATCH_FORMAT_LABEL_TH[value as MatchFormat] ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(MATCH_FORMAT_LABEL_TH) as [MatchFormat, string][]).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="space-y-1 border-t pt-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <EyeOff className="h-3.5 w-3.5" /> การแสดงผล + Privacy
          </h3>
          <ToggleRow
            id="color-summary"
            label="Color summary (group stage)"
            description="การ์ด+กราฟแท่ง รวมคะแนนตามสี"
            checked={settings.color_summary}
            onChange={(v) => update("color_summary", v)}
          />
          <ToggleRow
            id="export-visible"
            label="ปุ่ม Export / Print"
            description="ซ่อนจาก public + owner page"
            checked={settings.export_visible}
            onChange={(v) => update("export_visible", v)}
          />
          <ToggleRow
            id="realtime"
            label="Realtime updates"
            description="ปิดเพื่อลด DB cost (TV ยัง auto-refresh 60s)"
            checked={settings.realtime_enabled}
            onChange={(v) => update("realtime_enabled", v)}
          />
          <ToggleRow
            id="queue-payload-sync"
            label="อัปเดตคิวแบบ granular (ทดลอง)"
            description="แพตช์เฉพาะแถวแมตช์ที่เปลี่ยนจาก Realtime payload แทนการรีเฟรชทั้งหน้า — คิวลื่นขึ้นตอนหลายสนาม (ต้องเปิด Realtime updates ด้วย)"
            checked={settings.queue_payload_sync}
            onChange={(v) => update("queue_payload_sync", v)}
          />
          <ToggleRow
            id="audit-log"
            label="Audit log"
            description="ปิดเพื่อ privacy / ลด write traffic"
            checked={settings.audit_log_enabled}
            onChange={(v) => update("audit_log_enabled", v)}
          />
          <ToggleRow
            id="force-reset"
            label="บังคับรีเซ็ตสายได้"
            description="อนุญาตรีเซ็ตแมตช์น็อคเอ้าที่รอบถัดไปจบแล้ว พร้อม cascade 1 ขั้น (ใช้กรณีพลาดบันทึกผลแล้วต้องแก้)"
            checked={settings.allow_force_bracket_reset}
            onChange={(v) => update("allow_force_bracket_reset", v)}
          />
          <ToggleRow
            id="knockout-fill-byes"
            label="เติมช่อง BYE ด้วยทีมอันดับถัดไป"
            description="โหมดทีม + แบ่งกลุ่ม: เมื่อผู้เข้ารอบไม่พอเต็มสาย ดึงทีมอันดับถัดไปที่ดีที่สุดข้ามกลุ่ม (เช่นที่ 3 ที่ดีสุด) มาเติมแทนการให้ BYE — ปิดอยู่ = ทีมหัวกลุ่มได้ BYE รอบแรก"
            checked={settings.knockout_fill_byes}
            onChange={(v) => update("knockout_fill_byes", v)}
          />
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="chart-orientation" className="text-sm">แนวกราฟแท่ง</Label>
              <p className="text-xs text-muted-foreground">
                เลือกแนวการแสดงผลกราฟแท่งใน Dashboard
              </p>
            </div>
            <Select
              value={settings.chart_orientation}
              onValueChange={(v) => update("chart_orientation", v as TournamentSettings["chart_orientation"])}
            >
              <SelectTrigger id="chart-orientation" className="w-36 h-8 text-xs">
                <SelectValue>
                  {(value) => (value === "vertical" ? "แนวตั้ง" : value === "horizontal" ? "แนวนอน" : "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vertical">แนวตั้ง</SelectItem>
                <SelectItem value="horizontal">แนวนอน</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="space-y-1 border-t pt-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Tv className="h-3.5 w-3.5" /> การแสดงผล TV
          </h3>

          <p className="text-xs text-muted-foreground/80 pt-1 pb-0.5">ส่วนต่างๆ ของหน้า TV</p>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <ToggleRow
              id="tv-show-team-chart"
              label="กราฟคะแนนสะสมแต่ละทีม"
              checked={settings.tv_show_team_chart}
              onChange={(v) => update("tv_show_team_chart", v)}
            />
            <ToggleRow
              id="tv-show-standings-carousel"
              label="ตารางอันดับ (carousel)"
              checked={settings.tv_show_standings_carousel}
              onChange={(v) => update("tv_show_standings_carousel", v)}
            />
            <ToggleRow
              id="tv-show-upcoming"
              label="กำลังเล่น / ถัดไป"
              checked={settings.tv_show_upcoming}
              onChange={(v) => update("tv_show_upcoming", v)}
            />
            <ToggleRow
              id="tv-show-completed"
              label="จบล่าสุด"
              checked={settings.tv_show_completed}
              onChange={(v) => update("tv_show_completed", v)}
            />
            <ToggleRow
              id="tv-show-fullscreen-button"
              label="ปุ่ม Fullscreen"
              checked={settings.tv_show_fullscreen_button}
              onChange={(v) => update("tv_show_fullscreen_button", v)}
            />
            <ToggleRow
              id="tv-show-bracket-link"
              label="ลิงก์ดูสาย"
              checked={settings.tv_show_bracket_link}
              onChange={(v) => update("tv_show_bracket_link", v)}
            />
          </div>

          <p className="text-xs text-muted-foreground/80 pt-3 pb-0.5">จำนวนรายการ</p>
          <NumberRow
            id="tv-completed-count"
            label='จำนวน "จบล่าสุด"'
            description="1–3 รายการ"
            value={settings.tv_completed_count}
            min={1}
            max={3}
            onChange={(v) => update("tv_completed_count", v)}
          />
          <NumberRow
            id="tv-standings-rows"
            label="จำนวนแถวอันดับ"
            description="0–50 แถวต่อหน้า carousel · 0 = ทั้งหมด"
            value={settings.tv_standings_rows}
            min={0}
            max={50}
            onChange={(v) => update("tv_standings_rows", v)}
          />

          <p className="text-xs text-muted-foreground/80 pt-3 pb-0.5">การหมุน / รีเฟรช</p>
          <NumberRow
            id="tv-carousel-interval"
            label="รอบหมุนตารางอันดับ (วินาที)"
            description="3–30 วินาที"
            value={settings.tv_carousel_interval_sec}
            min={3}
            max={30}
            onChange={(v) => update("tv_carousel_interval_sec", v)}
          />
          <NumberRow
            id="tv-upcoming-interval"
            label='รอบหมุน "กำลังเล่น / ถัดไป" (วินาที)'
            description="3–30 วินาที"
            value={settings.tv_upcoming_interval_sec}
            min={3}
            max={30}
            onChange={(v) => update("tv_upcoming_interval_sec", v)}
          />
          <NumberRow
            id="tv-refresh-interval"
            label="รอบรีเฟรชหน้า TV (วินาที)"
            description="30–300 วินาที (fallback เมื่อปิด Realtime)"
            value={settings.tv_refresh_interval_sec}
            min={30}
            max={300}
            onChange={(v) => update("tv_refresh_interval_sec", v)}
          />

          <p className="text-xs text-muted-foreground/80 pt-3 pb-0.5">ขนาดฟอนต์</p>
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="tv-standings-font-size" className="text-sm">ขนาดฟอนต์ตารางอันดับ</Label>
              <p className="text-xs text-muted-foreground">
                ปรับขนาดตัวอักษรในตารางคะแนน Division
              </p>
            </div>
            <Select
              value={settings.tv_standings_font_size}
              onValueChange={(v) => update("tv_standings_font_size", v as "sm" | "md" | "lg" | "xl")}
            >
              <SelectTrigger id="tv-standings-font-size" className="w-36 h-8 text-xs">
                <SelectValue>
                  {(value) =>
                    value === "sm" ? "เล็ก" : value === "md" ? "กลาง" : value === "lg" ? "ใหญ่" : value === "xl" ? "ใหญ่มาก" : ""
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sm">เล็ก</SelectItem>
                <SelectItem value="md">กลาง</SelectItem>
                <SelectItem value="lg">ใหญ่</SelectItem>
                <SelectItem value="xl">ใหญ่มาก</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
