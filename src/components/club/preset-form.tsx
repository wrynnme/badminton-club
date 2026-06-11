"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import * as z from "zod";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  createClubPresetAction,
  updateClubPresetAction,
} from "@/lib/actions/club-presets";
import { fieldErrors } from "@/lib/form-errors";
import type { ClubPreset } from "@/lib/types";
import type { ClubPresetConfig } from "@/lib/club/preset";

// ── Types ─────────────────────────────────────────────────────────────────────

type Regular = {
  name: string;
  start_time: string;
  end_time: string;
};

type FormValues = {
  name: string;
  venue: string;
  schedule_day: string;
  start_time: string;
  end_time: string;
  max_players: number;
  court_fee: number;
  shuttle_price: number;
  court_count: number;
  players_per_team: "1" | "2";
  rotation_mode: "fair_queue" | "winner_stays";
  queue_mode: "rest_longest" | "fifo" | "level_match" | "smart";
};

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: ClubPreset;
};

// ── Helper: preset → form defaults ───────────────────────────────────────────

function toFormDefaults(preset?: ClubPreset): FormValues {
  if (!preset) {
    return {
      name: "",
      venue: "",
      schedule_day: "",
      start_time: "",
      end_time: "",
      max_players: 12,
      court_fee: 0,
      shuttle_price: 0,
      court_count: 1,
      players_per_team: "2",
      rotation_mode: "fair_queue",
      queue_mode: "rest_longest",
    };
  }
  const c = preset.config;
  return {
    name: preset.name,
    venue: c.venue,
    schedule_day: c.schedule_day,
    start_time: c.start_time,
    end_time: c.end_time,
    max_players: c.max_players,
    court_fee: c.court_fee,
    shuttle_price: c.shuttle_price,
    court_count: c.court_count,
    players_per_team: String(c.players_per_team) as "1" | "2",
    rotation_mode: c.rotation_mode,
    queue_mode: c.queue_mode,
  };
}

function toRegulars(preset?: ClubPreset): Regular[] {
  if (!preset) return [];
  return (preset.config.regulars ?? []).map((r) => ({
    name: r.name,
    start_time: r.start_time ?? "",
    end_time: r.end_time ?? "",
  }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PresetFormDialog({ open, onOpenChange, preset }: Props) {
  const t = useTranslations("club.presetForm");
  const router = useRouter();
  const isEdit = !!preset;

  const DAYS = [
    t("monday"),
    t("tuesday"),
    t("wednesday"),
    t("thursday"),
    t("friday"),
    t("saturday"),
    t("sunday"),
  ];

  const formSchema = z.object({
    name: z.string().min(2, t("validationName")),
    venue: z.string(),
    schedule_day: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    max_players: z.number().int().min(2, t("validationMaxMin")).max(40, t("validationMaxMax")),
    court_fee: z.number().min(0, t("validationFeeMin")),
    shuttle_price: z.number().min(0, t("validationFeeMin")),
    court_count: z.number().int().min(1, t("validationCourtMin")).max(20, t("validationCourtMax")),
    players_per_team: z.enum(["1", "2"]),
    rotation_mode: z.enum(["fair_queue", "winner_stays"]),
    queue_mode: z.enum(["rest_longest", "fifo", "level_match", "smart"]),
  });

  // Regulars are managed outside TanStack Form (dynamic array UI),
  // then merged into the config at submit time.
  const [regulars, setRegulars] = useState<Regular[]>(() => toRegulars(preset));

  const [, startTransition] = useTransition();

  const form = useForm({
    defaultValues: toFormDefaults(preset),
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const config: ClubPresetConfig = {
        venue: value.venue,
        schedule_day: value.schedule_day,
        start_time: value.start_time,
        end_time: value.end_time,
        max_players: value.max_players,
        court_fee: value.court_fee,
        shuttle_price: value.shuttle_price,
        court_count: value.court_count,
        players_per_team: Number(value.players_per_team) as 1 | 2,
        rotation_mode: value.rotation_mode,
        queue_mode: value.queue_mode,
        // co_admin_ids: preserved on edit, empty on create (MVP — managed on the club itself)
        co_admin_ids: preset?.config.co_admin_ids ?? [],
        regulars: regulars
          .filter((r) => r.name.trim() !== "")
          .map((r) => ({
            name: r.name.trim(),
            profile_id: null,
            start_time: r.start_time || null,
            end_time: r.end_time || null,
          })),
      };

      let res: { ok: true } | { id: string } | { error: string };
      if (isEdit) {
        res = await updateClubPresetAction(preset.id, {
          name: value.name,
          config,
        });
      } else {
        res = await createClubPresetAction({ name: value.name, config });
      }

      if ("error" in res) {
        toast.error(res.error);
        return;
      }

      toast.success(isEdit ? t("toastSaved") : t("toastCreated"));
      onOpenChange(false);
      startTransition(() => router.refresh());
    },
  });

  // Reset both the form values and the regulars state whenever the dialog
  // opens or the edit target changes.
  // Pass fresh defaults explicitly — a bare form.reset() re-seeds from the
  // mount-time defaultValues (the first preset), so switching edit targets
  // without remount would lag by one preset.
  React.useEffect(() => {
    if (open) {
      setRegulars(toRegulars(preset));
      form.reset(toFormDefaults(preset));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset?.id]);

  // ── Regular helpers ────────────────────────────────────────────────────────

  function addRegular() {
    setRegulars((prev) => [...prev, { name: "", start_time: "", end_time: "" }]);
  }

  function removeRegular(idx: number) {
    setRegulars((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRegular(idx: number, patch: Partial<Regular>) {
    setRegulars((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  }

  // ── Numeric field ──────────────────────────────────────────────────────────
  // The four numeric inputs (max_players / court_count / court_fee /
  // shuttle_price) differ only by name/label/min/max — render them via one
  // helper. Closes over `form` so the field stays fully typed.
  function numberField(
    name: "max_players" | "court_count" | "court_fee" | "shuttle_price",
    label: string,
    min: number,
    max?: number,
  ) {
    return (
      <form.Field
        name={name}
        children={(field) => {
          const isInvalid =
            field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
              <Input
                id={field.name}
                type="number"
                min={min}
                max={max}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(Number(e.target.value))}
                aria-invalid={isInvalid}
                className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              {isInvalid && (
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              )}
            </Field>
          );
        }}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("titleEdit") : t("titleCreate")}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            {/* ── Name ─────────────────────────────────────────────────── */}
            <form.Field
              name="name"
              children={(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t("nameLabel")}</FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                      placeholder={t("namePlaceholder")}
                    />
                    {isInvalid && (
                      <FieldError errors={fieldErrors(field.state.meta.errors)} />
                    )}
                  </Field>
                );
              }}
            />

            {/* ── Venue ────────────────────────────────────────────────── */}
            <form.Field
              name="venue"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{t("venueLabel")}</FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={t("venuePlaceholder")}
                  />
                </Field>
              )}
            />

            {/* ── Schedule day ─────────────────────────────────────────── */}
            <form.Field
              name="schedule_day"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={`${field.name}-trigger`}>{t("scheduleDayLabel")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      if (v) field.handleChange(v);
                    }}
                  >
                    <SelectTrigger id={`${field.name}-trigger`} className="w-full">
                      <SelectValue>
                        {(v: string) => v || <span className="text-muted-foreground">{t("scheduleDayPlaceholder")}</span>}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.state.value && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-2 text-left mt-0.5"
                      onClick={() => field.handleChange("")}
                    >
                      {t("scheduleDayClear")}
                    </button>
                  )}
                </Field>
              )}
            />

            {/* ── Time ─────────────────────────────────────────────────── */}
            <Field>
              <FieldLabel>{t("timeLabel")}</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <form.Field
                  name="start_time"
                  children={(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                        {t("timeStart")}
                      </FieldLabel>
                      <Input
                        id={field.name}
                        type="time"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                />
                <form.Field
                  name="end_time"
                  children={(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                        {t("timeEnd")}
                      </FieldLabel>
                      <Input
                        id={field.name}
                        type="time"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                />
              </div>
            </Field>

            {/* ── Max players ──────────────────────────────────────────── */}
            {numberField("max_players", t("maxPlayersLabel"), 2, 40)}

            {/* ── Court count ──────────────────────────────────────────── */}
            {numberField("court_count", t("courtCountLabel"), 1, 20)}

            {/* ── Court fee ────────────────────────────────────────────── */}
            {numberField("court_fee", t("courtFeeLabel"), 0)}

            {/* ── Shuttle price ─────────────────────────────────────────── */}
            {numberField("shuttle_price", t("shuttlePriceLabel"), 0)}

            {/* ── Players per team ──────────────────────────────────────── */}
            <form.Field
              name="players_per_team"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={`${field.name}-trigger`}>{t("playersPerTeamLabel")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      if (v) field.handleChange(v as "1" | "2");
                    }}
                  >
                    <SelectTrigger id={`${field.name}-trigger`} className="w-full">
                      <SelectValue>
                        {(v: string) => (v === "1" ? t("playersPerTeamSingle") : t("playersPerTeamDouble"))}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{t("playersPerTeamSingle")}</SelectItem>
                      <SelectItem value="2">{t("playersPerTeamDouble")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />

            {/* ── Rotation mode ─────────────────────────────────────────── */}
            <form.Field
              name="rotation_mode"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={`${field.name}-trigger`}>{t("rotationModeLabel")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      if (v)
                        field.handleChange(v as "fair_queue" | "winner_stays");
                    }}
                  >
                    <SelectTrigger id={`${field.name}-trigger`} className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          v === "fair_queue"
                            ? t("rotationFairQueue")
                            : t("rotationWinnerStays")
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fair_queue">
                        {t("rotationFairQueue")}
                      </SelectItem>
                      <SelectItem value="winner_stays">
                        {t("rotationWinnerStays")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />

            {/* ── Queue mode ────────────────────────────────────────────── */}
            <form.Field
              name="queue_mode"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={`${field.name}-trigger`}>{t("queueModeLabel")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      if (v)
                        field.handleChange(
                          v as
                            | "rest_longest"
                            | "fifo"
                            | "level_match"
                            | "smart",
                        );
                    }}
                  >
                    <SelectTrigger id={`${field.name}-trigger`} className="w-full">
                      <SelectValue>
                        {(v: string) => {
                          if (v === "rest_longest") return t("queueRestLongest");
                          if (v === "fifo") return t("queueFifo");
                          if (v === "level_match") return t("queueLevelMatch");
                          if (v === "smart") return t("queueSmart");
                          return v;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rest_longest">
                        {t("queueRestLongest")}
                      </SelectItem>
                      <SelectItem value="fifo">{t("queueFifo")}</SelectItem>
                      <SelectItem value="level_match">{t("queueLevelMatch")}</SelectItem>
                      <SelectItem value="smart">{t("queueSmart")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />

            {/* ── Regulars ──────────────────────────────────────────────── */}
            <Field>
              <FieldLabel>{t("regularsLabel")}</FieldLabel>
              <div className="space-y-2">
                {regulars.map((reg, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <Input
                      value={reg.name}
                      onChange={(e) =>
                        updateRegular(idx, { name: e.target.value })
                      }
                      placeholder={t("regularPlayerPlaceholder", { number: idx + 1 })}
                      className="flex-1 min-w-0"
                    />
                    <Input
                      type="time"
                      value={reg.start_time}
                      onChange={(e) =>
                        updateRegular(idx, { start_time: e.target.value })
                      }
                      className="w-24 shrink-0"
                      title={t("regularStartTimeTitle")}
                    />
                    <Input
                      type="time"
                      value={reg.end_time}
                      onChange={(e) =>
                        updateRegular(idx, { end_time: e.target.value })
                      }
                      className="w-24 shrink-0"
                      title={t("regularEndTimeTitle")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeRegular(idx)}
                      aria-label={t("regularRemoveAriaLabel")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={addRegular}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t("addRegularButton")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("regularsNote")}
              </p>
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-4">
            <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="w-full sm:w-auto"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {isEdit ? t("submitting") : t("creating")}
                    </>
                  ) : isEdit ? (
                    t("savePreset")
                  ) : (
                    t("createPreset")
                  )}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
