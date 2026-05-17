"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, ListOrdered, EyeOff, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateTournamentSettingsAction } from "@/lib/actions/tournaments";
import {
  parseSettings,
  type TournamentSettings,
  type LineNotifyFlags,
} from "@/lib/tournament/settings";

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

export function SettingsManager({
  tournamentId,
  initialSettings,
}: {
  tournamentId: string;
  initialSettings: unknown;
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
              description="เมื่อสร้าง knockout bracket"
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
            label="บังคับสนามไม่ซ้อน"
            description="DB ยัง enforce ผ่าน partial unique index — flag นี้เป็น UI hint อนาคต"
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
            id="manual-after-bracket"
            label="Manual match หลังสร้างสาย (pair mode)"
            description="ปิดเพื่อล็อกตารางหลังเข้า knockout"
            checked={settings.allow_manual_match_after_bracket}
            onChange={(v) => update("allow_manual_match_after_bracket", v)}
          />
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
            id="audit-log"
            label="Audit log"
            description="ปิดเพื่อ privacy / ลด write traffic"
            checked={settings.audit_log_enabled}
            onChange={(v) => update("audit_log_enabled", v)}
          />
          <ToggleRow
            id="force-reset"
            label="Allow force reset bracket"
            description="bypass guard ตอน reset KO ที่รอบถัดไปเล่นแล้ว"
            checked={settings.allow_force_bracket_reset}
            onChange={(v) => update("allow_force_bracket_reset", v)}
          />
        </section>
      </CardContent>
    </Card>
  );
}
