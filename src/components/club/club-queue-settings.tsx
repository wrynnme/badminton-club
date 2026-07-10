"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { queueSettingsEqual, type ClubQueueSettings } from "@/lib/club/queue-settings";
import { setUnsavedGuard } from "@/lib/hooks/use-unsaved-guard";

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

/**
 * Explicit Save/Discard flow (not auto-save): every control below writes to a
 * local `draft` only. The footer's Save/Discard row appears once `draft`
 * diverges from `baseline` (the last-persisted value) and is the only place
 * that calls `updateClubQueueSettingsAction`. This mirrors how ClubTabs +
 * beforeunload should warn about the change — see `use-unsaved-guard.ts`.
 *
 * `club-court-manager.tsx` intentionally keeps its own auto-save debounce
 * (renaming a court moves live matches, so partial/uncommitted state there is
 * not a safe "draft" concept) — do not port this pattern back onto it.
 */
export function ClubQueueSettings({
  clubId,
  initial,
}: {
  clubId: string;
  initial: ClubQueueSettings;
}) {
  const t = useTranslations("club.queueSettings");
  const [draft, setDraft] = useState<ClubQueueSettings>(initial);
  const [baseline, setBaseline] = useState<ClubQueueSettings>(initial);
  const [isPending, startTransition] = useTransition();

  const dirty = !queueSettingsEqual(draft, baseline);

  // Register/deregister with the page-wide unsaved-changes guard so the tab
  // shell (ClubTabs) can block a tab switch while this card has unsaved edits.
  useEffect(() => {
    setUnsavedGuard("club-queue-settings", dirty);
    return () => setUnsavedGuard("club-queue-settings", false);
  }, [dirty]);

  // Warn on browser close/refresh/back while dirty. Note: this does NOT
  // intercept in-app client-side navigation to a different route (Next App
  // Router link clicks) — only the native browser unload dialog + the
  // ClubTabs tab-switch guard are covered.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function update<K extends keyof ClubQueueSettings>(
    key: K,
    value: ClubQueueSettings[K],
  ) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function discard() {
    setDraft(baseline);
  }

  function save() {
    startTransition(async () => {
      const res = await updateClubQueueSettingsAction(clubId, draft);
      if (res && "error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      setBaseline(draft);
      toast.success(t("savedToast"));
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Settings2 className="h-4 w-4" />
          {t("title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("description")}
        </p>
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
            value={String(draft.players_per_team)}
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
            value={draft.rotation_mode}
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
        {draft.rotation_mode === "winner_stays" && (
          <NumberRow
            id="qs-winner-stays-max"
            label={t("winnerStaysMaxLabel")}
            description={t("winnerStaysMaxDesc")}
            value={draft.winner_stays_max}
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
            value={draft.queue_mode}
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
          checked={draft.skill_level_enabled}
          onChange={(v) => update("skill_level_enabled", v)}
        />

        {/* Skill level sub-controls — only when skill_level_enabled */}
        {draft.skill_level_enabled && (
          <div className="ml-7 space-y-1 border-l pl-3 border-border">
            {/* Max skill gap */}
            <NumberRow
              id="qs-max-skill-gap"
              label={t("maxSkillGapLabel")}
              description={t("maxSkillGapDesc")}
              value={draft.max_skill_gap}
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
                      value={draft.balance_strictness}
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
              checked={draft.balance_locked_pairs}
              onChange={(v) => update("balance_locked_pairs", v)}
            />
          </div>
        )}

        {/* Game time limit */}
        <NumberRow
          id="qs-time-limit"
          label={t("timeLimitLabel")}
          description={t("timeLimitDesc")}
          value={draft.game_time_limit_min}
          min={0}
          max={120}
          onChange={(v) => update("game_time_limit_min", v)}
        />

        {/* Realtime auto-refresh */}
        <ToggleRow
          id="qs-realtime"
          label={t("realtimeEnabledLabel")}
          description={t("realtimeEnabledDesc")}
          checked={draft.realtime_enabled}
          onChange={(v) => update("realtime_enabled", v)}
        />

        {dirty && (
          <div className="flex items-center justify-end gap-2 pt-3 mt-2 border-t border-border">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={discard}
                    disabled={isPending}
                  >
                    {t("discardButton")}
                  </Button>
                }
              />
              <TooltipContent>{t("discardTooltip")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button type="button" size="sm" onClick={save} disabled={isPending}>
                    {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                    {t("saveButton")}
                  </Button>
                }
              />
              <TooltipContent>{t("saveTooltip")}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
