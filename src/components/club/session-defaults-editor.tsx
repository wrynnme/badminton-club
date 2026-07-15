"use client";

/**
 * SessionDefaultsEditor — ADR 0002 decision #15 ("Session config source =
 * explicit series defaults"): edits `club_series.session_defaults`, the config
 * every future "จัดก๊วน" reads from. Per-session edits never write back here —
 * this editor is the ONLY place that mutates the default snapshot, either by
 * hand (Save) or via the explicit "ใช้ค่าจากนัดปัจจุบัน" adopt action.
 *
 * Parent (`series-home.tsx`) should key this component on
 * `JSON.stringify(series.session_defaults)` so a save/adopt (which both
 * `revalidateClubTree()` + `router.refresh()`) remounts the form with the
 * freshly-persisted values instead of the TanStack Form defaultValues going
 * stale (defaultValues only seed the store once, on mount).
 */

import { useState, useTransition } from "react";
import { fieldErrors } from "@/lib/form-errors";
import * as z from "zod";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { adoptSessionAsDefaultsAction, updateSessionDefaultsAction } from "@/lib/actions/club-series";
import { SESSION_FALLBACKS, type SessionDefaults } from "@/lib/club/session-defaults";
import type { CourtSplit, ShuttleSplit } from "@/lib/types";

type FormValues = {
  venue: string;
  start_time: string;
  end_time: string;
  max_players: number;
  court_fee: number;
  shuttle_price: number;
  court_split: CourtSplit;
  shuttle_split: ShuttleSplit;
  courts: string[];
};

function toFormValues(d: SessionDefaults): FormValues {
  return {
    venue: d.venue ?? "",
    start_time: (d.start_time ?? SESSION_FALLBACKS.start_time).slice(0, 5),
    end_time: (d.end_time ?? SESSION_FALLBACKS.end_time).slice(0, 5),
    max_players: d.max_players ?? SESSION_FALLBACKS.max_players,
    court_fee: d.court_fee ?? 0,
    shuttle_price: d.shuttle_price ?? 0,
    court_split: d.court_split ?? "even",
    shuttle_split: d.shuttle_split ?? "even",
    courts: d.courts,
  };
}

/** Lightweight add/remove courts list — no DnD (see `club-court-manager.tsx`
 *  for the ordered/renameable version used on a live session). */
function CourtsField({ courts, onChange }: { courts: string[]; onChange: (next: string[]) => void }) {
  const t = useTranslations("club.sessionDefaults");
  const tCourt = useTranslations("club.courtManager");
  const [newName, setNewName] = useState("");

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (courts.includes(name)) {
      toast.error(tCourt("duplicateName"));
      return;
    }
    onChange([...courts, name]);
    setNewName("");
  };

  return (
    <Field>
      <FieldLabel>{t("courtsLabel")}</FieldLabel>
      {courts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("courtsEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {courts.map((name) => (
            <li key={name} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5">
              <span className="flex-1 min-w-0 truncate text-sm">{name}</span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={tCourt("removeAriaLabel", { name })}
                      className="text-destructive hover:text-destructive"
                      onClick={() => onChange(courts.filter((c) => c !== name))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>{tCourt("removeTooltip", { name })}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={tCourt("addPlaceholder")}
          maxLength={40}
          className="h-8 text-sm"
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button type="button" size="sm" onClick={add} disabled={!newName.trim()}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {tCourt("addButton")}
              </Button>
            }
          />
          <TooltipContent>{tCourt("addTooltip")}</TooltipContent>
        </Tooltip>
      </div>
    </Field>
  );
}

function AdoptDefaultsButton({
  seriesId,
  activeSessionId,
}: {
  seriesId: string;
  activeSessionId: string;
}) {
  const t = useTranslations("club.sessionDefaults");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      const res = await adoptSessionAsDefaultsAction({ seriesId, clubId: activeSessionId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toastAdopted"));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              {t("adoptButton")}
            </Button>
          }
        />
        <TooltipContent>{t("adoptTooltip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              {t("adoptConfirmTitle")}
            </DialogTitle>
            <DialogDescription>{t("adoptConfirmDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose render={<Button variant="outline" disabled={pending}>{t("adoptConfirmCancel")}</Button>} />
            <Button onClick={handleConfirm} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  {t("adopting")}
                </>
              ) : (
                t("adoptConfirmButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SessionDefaultsEditor({
  seriesId,
  initial,
  activeSessionId,
}: {
  seriesId: string;
  initial: SessionDefaults;
  /** The series' active session (decision #3) — the adopt button only shows
   *  when one exists; null when the series has no sessions yet or no pointer. */
  activeSessionId: string | null;
}) {
  const t = useTranslations("club.sessionDefaults");
  const tCost = useTranslations("club.costManager");
  const router = useRouter();

  const formSchema = z.object({
    venue: z.string().max(120),
    start_time: z.string(),
    end_time: z.string(),
    max_players: z.number().int().min(2, t("validationMaxMin")).max(40, t("validationMaxMax")),
    court_fee: z.number().min(0, t("validationFeeMin")),
    shuttle_price: z.number().min(0, t("validationFeeMin")),
    court_split: z.enum(["even", "by_time"]),
    shuttle_split: z.enum(["even", "per_match", "per_player", "by_time"]),
    courts: z.array(z.string()),
  });

  const form = useForm({
    defaultValues: toFormValues(initial),
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const patch: Partial<SessionDefaults> = {
        venue: value.venue.trim() || null,
        start_time: value.start_time || null,
        end_time: value.end_time || null,
        max_players: value.max_players,
        court_fee: value.court_fee,
        shuttle_price: value.shuttle_price,
        court_split: value.court_split,
        shuttle_split: value.shuttle_split,
        courts: value.courts,
      };
      const res = await updateSessionDefaultsAction({ seriesId, patch });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toastSaved"));
      router.refresh();
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        {activeSessionId && <AdoptDefaultsButton seriesId={seriesId} activeSessionId={activeSessionId} />}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t("desc")}</p>

        <form
          id="session-defaults-form"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field
              name="venue"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t("venueLabel")}</FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder={t("venuePlaceholder")}
                      aria-invalid={isInvalid}
                    />
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            />

            <div className="grid grid-cols-2 gap-2">
              <form.Field
                name="start_time"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>{t("startLabel")}</FieldLabel>
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
                    <FieldLabel htmlFor={field.name}>{t("endLabel")}</FieldLabel>
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

            <form.Field
              name="max_players"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t("maxPlayersLabel")}</FieldLabel>
                    <div className="max-w-[140px]">
                      <NumberInput
                        min={2}
                        max={40}
                        step={1}
                        value={field.state.value}
                        onValueChange={field.handleChange}
                        aria-invalid={isInvalid}
                      />
                    </div>
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            />

            <div className="grid grid-cols-2 gap-2">
              <form.Field
                name="court_fee"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>{t("courtFeeLabel")}</FieldLabel>
                    <NumberInput min={0} step={1} value={field.state.value} onValueChange={field.handleChange} />
                  </Field>
                )}
              />
              <form.Field
                name="shuttle_price"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>{t("shuttleFeeLabel")}</FieldLabel>
                    <NumberInput min={0} step={1} value={field.state.value} onValueChange={field.handleChange} />
                  </Field>
                )}
              />
            </div>

            <form.Field
              name="court_split"
              children={(field) => (
                <Field>
                  <FieldLabel>{t("courtSplitLabel")}</FieldLabel>
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={field.state.value === "even" ? "default" : "outline"}
                      onClick={() => field.handleChange("even")}
                      className="h-7 text-xs"
                    >
                      {tCost("splitEven")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={field.state.value === "by_time" ? "default" : "outline"}
                      onClick={() => field.handleChange("by_time")}
                      className="h-7 text-xs"
                    >
                      {tCost("splitByTime")}
                    </Button>
                  </div>
                </Field>
              )}
            />

            <form.Field
              name="shuttle_split"
              children={(field) => (
                <Field>
                  <FieldLabel>{t("shuttleSplitLabel")}</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={field.state.value === "even" ? "default" : "outline"}
                      onClick={() => field.handleChange("even")}
                      className="h-7 text-xs"
                    >
                      {tCost("splitEven")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={field.state.value === "by_time" ? "default" : "outline"}
                      onClick={() => field.handleChange("by_time")}
                      className="h-7 text-xs"
                    >
                      {tCost("splitByHour")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={field.state.value === "per_match" ? "default" : "outline"}
                      onClick={() => field.handleChange("per_match")}
                      className="h-7 text-xs"
                    >
                      {tCost("splitPerShuttle")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={field.state.value === "per_player" ? "default" : "outline"}
                      onClick={() => field.handleChange("per_player")}
                      className="h-7 text-xs"
                    >
                      {tCost("splitPerMatch")}
                    </Button>
                  </div>
                </Field>
              )}
            />

            <form.Field
              name="courts"
              children={(field) => <CourtsField courts={field.state.value} onChange={field.handleChange} />}
            />
          </FieldGroup>

          <Field orientation="horizontal" className="mt-5">
            <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {isSubmitting ? t("saving") : t("saveButton")}
                </Button>
              )}
            </form.Subscribe>
          </Field>
        </form>
      </CardContent>
    </Card>
  );
}
