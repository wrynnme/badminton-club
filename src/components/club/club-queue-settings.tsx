"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateClubQueueSettingsAction } from "@/lib/actions/clubs";
import type { ClubQueueSettings } from "@/lib/club/queue-settings";

const DEBOUNCE_MS = 500;

// ─── Reusable row sub-components ─────────────────────────────────────────────

function NumberRow({
  id,
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
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
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-20 h-8 text-sm shrink-0"
      />
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Checkbox
        id={id}
        checked={checked}
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

// ─── Main component ───────────────────────────────────────────────────────────

export function ClubQueueSettings({
  clubId,
  initial,
}: {
  clubId: string;
  initial: ClubQueueSettings;
}) {
  const [settings, setSettings] = useState<ClubQueueSettings>(initial);
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  const pendingPatchRef = useRef<Partial<ClubQueueSettings> | null>(null);

  async function flush(patch: Partial<ClubQueueSettings>) {
    if (inFlightRef.current) await inFlightRef.current;
    setSaving(true);
    const p = updateClubQueueSettingsAction(clubId, patch);
    inFlightRef.current = p;
    const res = await p;
    inFlightRef.current = null;
    pendingPatchRef.current = null;
    setSaving(false);
    if (res && "error" in res && res.error) {
      toast.error(res.error);
    }
  }

  // Unmount-flush: fire-and-forget any pending patch when navigating away.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      const patch = pendingPatchRef.current;
      if (patch) void flush(patch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(patch: Partial<ClubQueueSettings>, next: ClubQueueSettings) {
    setSettings(next);
    pendingPatchRef.current = { ...(pendingPatchRef.current ?? {}), ...patch };
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const queued = pendingPatchRef.current;
      if (!queued) return;
      startTransition(() => flush(queued));
    }, DEBOUNCE_MS);
  }

  function update<K extends keyof ClubQueueSettings>(
    key: K,
    value: ClubQueueSettings[K],
  ) {
    commit({ [key]: value } as Partial<ClubQueueSettings>, {
      ...settings,
      [key]: value,
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Settings2 className="h-4 w-4" />
            ตั้งค่าระบบหมุนคิว
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            ใช้สำหรับระบบหมุนคิวอัตโนมัติ
          </p>
        </div>
        {saving && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
        )}
      </CardHeader>

      <CardContent className="space-y-1">
        {/* Court count */}
        <NumberRow
          id="qs-court-count"
          label="จำนวนสนาม"
          description="จำนวนสนามที่เปิดใช้งาน (1–20)"
          value={settings.court_count}
          min={1}
          max={20}
          onChange={(v) => update("court_count", v)}
        />

        {/* Players per team */}
        <div className="flex items-center justify-between gap-3 py-1.5">
          <div className="space-y-0.5 leading-tight min-w-0">
            <Label htmlFor="qs-players-per-team" className="text-sm font-medium">
              ผู้เล่นต่อทีม
            </Label>
            <p className="text-xs text-muted-foreground">เดี่ยว (1) หรือ คู่ (2)</p>
          </div>
          <Select
            value={String(settings.players_per_team)}
            onValueChange={(v) =>
              update("players_per_team", Number(v) as 1 | 2)
            }
          >
            <SelectTrigger id="qs-players-per-team" className="w-28 h-8 text-sm">
              <SelectValue>
                {(v: string) => (v === "1" ? "เดี่ยว" : "คู่")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">เดี่ยว</SelectItem>
              <SelectItem value="2">คู่</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Rotation mode */}
        <div className="flex items-center justify-between gap-3 py-1.5">
          <div className="space-y-0.5 leading-tight min-w-0">
            <Label htmlFor="qs-rotation-mode" className="text-sm font-medium">
              รูปแบบการหมุน
            </Label>
            <p className="text-xs text-muted-foreground">
              Fair Queue = หมุนทุกคน, Winner Stays = ผู้ชนะอยู่ต่อ
            </p>
          </div>
          <Select
            value={settings.rotation_mode}
            onValueChange={(v) =>
              update(
                "rotation_mode",
                v as ClubQueueSettings["rotation_mode"],
              )
            }
          >
            <SelectTrigger id="qs-rotation-mode" className="w-40 h-8 text-sm">
              <SelectValue>
                {(v: string) =>
                  v === "fair_queue"
                    ? "Fair Queue"
                    : "Winner Stays"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fair_queue">
                Fair Queue (หมุนทุกคน)
              </SelectItem>
              <SelectItem value="winner_stays">
                Winner Stays (ผู้ชนะอยู่ต่อ)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Winner stays max — only when winner_stays */}
        {settings.rotation_mode === "winner_stays" && (
          <NumberRow
            id="qs-winner-stays-max"
            label="ชนะติดสูงสุด"
            description="ชนะติดกันได้กี่เกมก่อนบังคับพัก (0 = ไม่จำกัด)"
            value={settings.winner_stays_max}
            min={0}
            max={20}
            onChange={(v) => update("winner_stays_max", v)}
          />
        )}

        {/* Queue mode */}
        <div className="flex items-center justify-between gap-3 py-1.5">
          <div className="space-y-0.5 leading-tight min-w-0">
            <Label htmlFor="qs-queue-mode" className="text-sm font-medium">
              โหมดคิว
            </Label>
            <p className="text-xs text-muted-foreground">
              อัลกอริทึมในการเลือกผู้เล่นถัดไป
            </p>
          </div>
          <Select
            value={settings.queue_mode}
            onValueChange={(v) =>
              update("queue_mode", v as ClubQueueSettings["queue_mode"])
            }
          >
            <SelectTrigger id="qs-queue-mode" className="w-44 h-8 text-sm">
              <SelectValue>
                {(v: string) => {
                  if (v === "rest_longest") return "พักนานก่อน";
                  if (v === "fifo") return "เข้าก่อนได้ก่อน";
                  if (v === "level_match") return "จับคู่ตามระดับ";
                  if (v === "smart") return "อัจฉริยะ";
                  return v;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rest_longest">
                พักนานก่อน (แนะนำ)
              </SelectItem>
              <SelectItem value="fifo">เข้าก่อนได้ก่อน</SelectItem>
              <SelectItem value="level_match">จับคู่ตามระดับ</SelectItem>
              <SelectItem value="smart">อัจฉริยะ</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Skill level enabled */}
        <ToggleRow
          id="qs-skill-level"
          label="ใช้ระดับฝีมือ"
          description="เปิดเพื่อให้ระบบพิจารณาระดับผู้เล่นในการจับคู่"
          checked={settings.skill_level_enabled}
          onChange={(v) => update("skill_level_enabled", v)}
        />

        {/* Game time limit */}
        <NumberRow
          id="qs-time-limit"
          label="จำกัดเวลา/เกม (นาที)"
          description="แสดงเป็น hint สำหรับ referee (0 = ไม่จำกัด)"
          value={settings.game_time_limit_min}
          min={0}
          max={120}
          onChange={(v) => update("game_time_limit_min", v)}
        />

        {/* Not ready action */}
        <div className="flex items-center justify-between gap-3 py-1.5">
          <div className="space-y-0.5 leading-tight min-w-0">
            <Label htmlFor="qs-not-ready" className="text-sm font-medium">
              เมื่อไม่พร้อม
            </Label>
            <p className="text-xs text-muted-foreground">
              ทำอะไรเมื่อผู้เล่นไม่พร้อมเล่น
            </p>
          </div>
          <Select
            value={settings.not_ready_action}
            onValueChange={(v) =>
              update(
                "not_ready_action",
                v as ClubQueueSettings["not_ready_action"],
              )
            }
          >
            <SelectTrigger id="qs-not-ready" className="w-36 h-8 text-sm">
              <SelectValue>
                {(v: string) =>
                  v === "requeue" ? "ต่อท้ายคิว" : "ข้าม"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="requeue">ต่อท้ายคิว</SelectItem>
              <SelectItem value="skip">ข้าม</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
