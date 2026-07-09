"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const t = useTranslations("club.queueSettings");
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
      // Claim the patch BEFORE dispatching — any change made while this save is
      // in flight accumulates into a fresh patch + its own timer (no lost update).
      pendingPatchRef.current = null;
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
            {t("title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("description")}
          </p>
        </div>
        {saving && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
        )}
      </CardHeader>

      <CardContent className="space-y-1">
        {/* Courts are managed via the named-court list (ClubCourtManager) above. */}

        {/* Players per team */}
        <div className="flex items-center justify-between gap-3 py-1.5">
          <div className="space-y-0.5 leading-tight min-w-0">
            <Label htmlFor="qs-players-per-team" className="text-sm font-medium">
              {t("playersPerTeamLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("playersPerTeamDesc")}</p>
          </div>
          <Select
            value={String(settings.players_per_team)}
            onValueChange={(v) =>
              update("players_per_team", Number(v) as 1 | 2)
            }
          >
            <SelectTrigger id="qs-players-per-team" className="w-28 h-8 text-sm">
              <SelectValue>
                {(v: string) => (v === "1" ? t("playersPerTeamSingle") : t("playersPerTeamDouble"))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t("playersPerTeamSingle")}</SelectItem>
              <SelectItem value="2">{t("playersPerTeamDouble")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Rotation mode */}
        <div className="flex items-center justify-between gap-3 py-1.5">
          <div className="space-y-0.5 leading-tight min-w-0">
            <Label htmlFor="qs-rotation-mode" className="text-sm font-medium">
              {t("rotationModeLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("rotationModeDesc")}
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
                    ? t("rotationFairQueue")
                    : v === "winner_stays"
                      ? t("rotationWinnerStays")
                      : t("rotationFairWinnerFallback")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fair_queue">
                {t("rotationFairQueueFull")}
              </SelectItem>
              <SelectItem value="winner_stays">
                {t("rotationWinnerStaysFull")}
              </SelectItem>
              <SelectItem value="fair_winner_fallback">
                {t("rotationFairWinnerFallbackFull")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Winner stays max — only when winner_stays */}
        {settings.rotation_mode === "winner_stays" && (
          <NumberRow
            id="qs-winner-stays-max"
            label={t("winnerStaysMaxLabel")}
            description={t("winnerStaysMaxDesc")}
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
              {t("queueModeLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("queueModeDesc")}
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
                  if (v === "rest_longest") return t("queueRestLongest");
                  if (v === "fifo") return t("queueFifo");
                  if (v === "level_match") return t("queueLevelMatch");
                  return v;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rest_longest">
                {t("queueRestLongestFull")}
              </SelectItem>
              <SelectItem value="fifo">{t("queueFifo")}</SelectItem>
              <SelectItem value="level_match">{t("queueLevelMatch")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Skill level enabled */}
        <ToggleRow
          id="qs-skill-level"
          label={t("skillLevelLabel")}
          description={t("skillLevelDesc")}
          checked={settings.skill_level_enabled}
          onChange={(v) => update("skill_level_enabled", v)}
        />

        {/* Skill level sub-controls — only when skill_level_enabled */}
        {settings.skill_level_enabled && (
          <div className="ml-7 space-y-1 border-l pl-3 border-border">
            {/* Max skill gap */}
            <NumberRow
              id="qs-max-skill-gap"
              label={t("maxSkillGapLabel")}
              description={t("maxSkillGapDesc")}
              value={settings.max_skill_gap}
              min={0}
              max={20}
              onChange={(v) => update("max_skill_gap", v)}
            />

            {/* Balance strictness */}
            <div className="flex items-center justify-between gap-3 py-1.5">
              <div className="space-y-0.5 leading-tight min-w-0">
                <Label htmlFor="qs-balance-strictness" className="text-sm font-medium">
                  {t("balanceStrictnessLabel")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("balanceStrictnessDesc")}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Select
                      value={settings.balance_strictness}
                      onValueChange={(v) =>
                        update(
                          "balance_strictness",
                          v as ClubQueueSettings["balance_strictness"],
                        )
                      }
                    >
                      <SelectTrigger id="qs-balance-strictness" className="w-44 h-8 text-sm">
                        <SelectValue>
                          {(v: string) => {
                            if (v === "strict") return t("strictnessStrict");
                            return t("strictnessBalanced");
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="balanced">{t("strictnessBalanced")}</SelectItem>
                        <SelectItem value="strict">{t("strictnessStrict")}</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
                <TooltipContent>{t("balanceStrictnessTooltip")}</TooltipContent>
              </Tooltip>
            </div>

            {/* Balance locked pairs */}
            <ToggleRow
              id="qs-balance-locked-pairs"
              label={t("balanceLockedPairsLabel")}
              description={t("balanceLockedPairsDesc")}
              checked={settings.balance_locked_pairs}
              onChange={(v) => update("balance_locked_pairs", v)}
            />
          </div>
        )}

        {/* Game time limit */}
        <NumberRow
          id="qs-time-limit"
          label={t("timeLimitLabel")}
          description={t("timeLimitDesc")}
          value={settings.game_time_limit_min}
          min={0}
          max={120}
          onChange={(v) => update("game_time_limit_min", v)}
        />

        {/* Realtime auto-refresh */}
        <ToggleRow
          id="qs-realtime"
          label={t("realtimeEnabledLabel")}
          description={t("realtimeEnabledDesc")}
          checked={settings.realtime_enabled}
          onChange={(v) => update("realtime_enabled", v)}
        />
      </CardContent>
    </Card>
  );
}
