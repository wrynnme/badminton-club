"use client";

import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { createTournamentAction } from "@/lib/actions/tournaments";
import type { TournamentFormat, SeedingMethod, MatchUnit, TournamentMode } from "@/lib/types";
import { fieldErrors } from "@/lib/form-errors";
import { ThresholdChipList } from "./threshold-chip-list";

const TEAM_COUNT_PRESETS = [4, 6, 8, 12, 16];

export function CreateTournamentForm() {
  const t = useTranslations("tournament");

  const formSchema = z.object({
    name: z.string().min(2, t("createTournamentForm.errorNameTooShort")),
    venue: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    format: z.enum(["group_only", "group_knockout", "knockout_only"]),
    mode: z.enum(["sports_day", "competition"]),
    match_unit: z.enum(["team", "pair"]),
    has_lower_bracket: z.boolean(),
    allow_drop_to_lower: z.boolean(),
    seeding_method: z.enum(["random", "by_group_score"]),
    advance_count: z.number().int().min(1).max(8),
    team_count: z.number().int().min(2, t("createTournamentForm.errorMinTeams")).max(64),
    pair_division_thresholds: z.array(z.number()),
    notes: z.string(),
  });

  const form = useForm({
    defaultValues: {
      name: "",
      venue: "",
      start_date: "",
      end_date: "",
      format: "group_only" as TournamentFormat,
      mode: "sports_day" as TournamentMode,
      match_unit: "team" as MatchUnit,
      has_lower_bracket: false,
      allow_drop_to_lower: false,
      seeding_method: "random" as SeedingMethod,
      advance_count: 2,
      team_count: 4,
      pair_division_thresholds: [] as number[],
      notes: "",
    },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const res = await createTournamentAction(value);
      if (res?.error) toast.error(res.error);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="name"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{t("createTournamentForm.fieldName")}</FieldLabel>
                <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)} aria-invalid={isInvalid}
                  placeholder={t("createTournamentForm.placeholderName")} />
                {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
              </Field>
            );
          }}
        />

        <form.Field name="venue">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t("createTournamentForm.fieldVenue")}</FieldLabel>
              <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)} placeholder={t("createTournamentForm.placeholderVenue")} />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-2">
          <form.Field name="start_date">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>{t("createTournamentForm.fieldStartDate")}</FieldLabel>
                <Input id={field.name} type="date" value={field.state.value}
                  onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              </Field>
            )}
          </form.Field>
          <form.Field name="end_date">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>{t("createTournamentForm.fieldEndDate")}</FieldLabel>
                <Input id={field.name} type="date" value={field.state.value}
                  onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              </Field>
            )}
          </form.Field>
        </div>

        {/* Mode — card selector (กีฬาสี / แข่งขัน), both selectable */}
        <form.Field name="mode">
          {(field) => (
            <Field>
              <FieldLabel>{t("createTournamentForm.fieldMode")}</FieldLabel>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: "sports_day", title: t("createTournamentForm.modeSportsDay"), desc: t("createTournamentForm.modeSportsDayDesc") },
                  { value: "competition", title: t("createTournamentForm.modeCompetition"), desc: t("createTournamentForm.modeCompetitionDesc") },
                ] as const).map((opt) => {
                  const active = field.state.value === opt.value;
                  return (
                    <Button
                      key={opt.value}
                      type="button"
                      variant="outline"
                      aria-pressed={active}
                      onClick={() => {
                        field.handleChange(opt.value);
                        if (opt.value === "competition") form.setFieldValue("match_unit", "pair");
                      }}
                      className={`h-auto flex-col items-start gap-1 p-3 text-left whitespace-normal ${active ? "border-primary ring-1 ring-primary bg-primary/5" : ""}`}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="font-medium">{opt.title}</span>
                        {active && <Badge className="text-[10px] px-1.5 py-0">{t("createTournamentForm.badgeSelected")}</Badge>}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">{opt.desc}</span>
                    </Button>
                  );
                })}
              </div>
              <FieldDescription>
                {field.state.value === "competition"
                  ? t("createTournamentForm.modeDescCompetition")
                  : t("createTournamentForm.modeDescSportsDay")}
              </FieldDescription>
            </Field>
          )}
        </form.Field>

        {/* Format */}
        <form.Field name="format">
          {(field) => (
            <Field>
              <FieldLabel>{t("createTournamentForm.fieldFormat")}</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: "group_only", label: t("createTournamentForm.formatGroupOnly") },
                  { value: "group_knockout", label: t("createTournamentForm.formatGroupKnockout") },
                  { value: "knockout_only", label: t("createTournamentForm.formatKnockoutOnly") },
                ] as const).map((opt) => (
                  <Button key={opt.value} type="button" size="sm"
                    variant={field.state.value === opt.value ? "default" : "outline"}
                    onClick={() => field.handleChange(opt.value)}>
                    {opt.label}
                  </Button>
                ))}
              </div>
            </Field>
          )}
        </form.Field>

        {/* Match unit — sports_day only; competition forces pair vs pair */}
        <form.Subscribe selector={(s) => s.values.mode}>
          {(mode) => mode === "sports_day" ? (
            <form.Field name="match_unit">
              {(field) => (
                <Field>
                  <FieldLabel>{t("createTournamentForm.fieldMatchUnit")}</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: "team", label: t("createTournamentForm.unitTeamVsTeam"), desc: t("createTournamentForm.unitTeamDesc") },
                      { value: "pair", label: t("createTournamentForm.unitPairVsPair"), desc: t("createTournamentForm.unitPairDesc") },
                    ] as const).map((opt) => (
                      <Button key={opt.value} type="button" size="sm"
                        variant={field.state.value === opt.value ? "default" : "outline"}
                        onClick={() => field.handleChange(opt.value)}
                        title={opt.desc}>
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                  <FieldDescription>
                    {field.state.value === "pair"
                      ? t("createTournamentForm.unitDescPair")
                      : t("createTournamentForm.unitDescTeam")}
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
          ) : (
            <Field>
              <FieldLabel>{t("createTournamentForm.fieldMatchUnit")}</FieldLabel>
              <FieldDescription>{t("editTournamentForm.unitLockedPair")}</FieldDescription>
            </Field>
          )}
        </form.Subscribe>

        {/* Pair division thresholds — sports_day pair mode only (competition uses classes, not divisions) */}
        <form.Subscribe selector={(s) => [s.values.match_unit, s.values.mode] as const}>
          {([unit, mode]) => unit === "pair" && mode === "sports_day" && (
            <form.Field name="pair_division_thresholds">
              {(field) => (
                <ThresholdChipList
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
          )}
        </form.Subscribe>

        {/* Advance count — shown for group_knockout */}
        <form.Subscribe selector={(s) => s.values.format}>
          {(fmt) => fmt === "group_knockout" && (
            <form.Field name="advance_count">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{t("createTournamentForm.fieldAdvanceCount")}</FieldLabel>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4].map((n) => (
                      <Button key={n} type="button" size="sm"
                        variant={field.state.value === n ? "default" : "outline"}
                        className="h-8 w-8 p-0"
                        onClick={() => field.handleChange(n)}>
                        {n}
                      </Button>
                    ))}
                  </div>
                  <FieldDescription>{t("createTournamentForm.advanceCountDesc")}</FieldDescription>
                </Field>
              )}
            </form.Field>
          )}
        </form.Subscribe>

        {/* Lower bracket options */}
        <form.Subscribe selector={(s) => s.values.format}>
          {(fmt) => fmt !== "group_only" && (
            <div className="space-y-3 pl-3 border-l-2 border-muted">
              <form.Field name="has_lower_bracket">
                {(field) => (
                  <Field orientation="horizontal">
                    <input type="checkbox" id="has_lower_bracket" checked={field.state.value}
                      onChange={(e) => field.handleChange(e.target.checked)} className="mt-0.5" />
                    <div>
                      <FieldLabel htmlFor="has_lower_bracket">{t("createTournamentForm.hasLowerBracket")}</FieldLabel>
                      <FieldDescription>3rd-A vs 4th-B, 3rd-B vs 4th-C ...</FieldDescription>
                    </div>
                  </Field>
                )}
              </form.Field>

              <form.Subscribe selector={(s) => s.values.has_lower_bracket}>
                {(hasLower) => hasLower && (
                  <form.Field name="allow_drop_to_lower">
                    {(field) => (
                      <Field orientation="horizontal">
                        <input type="checkbox" id="allow_drop_to_lower" checked={field.state.value}
                          onChange={(e) => field.handleChange(e.target.checked)} className="mt-0.5" />
                        <div>
                          <FieldLabel htmlFor="allow_drop_to_lower">{t("createTournamentForm.allowDropToLower")}</FieldLabel>
                          <FieldDescription>{t("createTournamentForm.allowDropToLowerDefault")}</FieldDescription>
                        </div>
                      </Field>
                    )}
                  </form.Field>
                )}
              </form.Subscribe>
            </div>
          )}
        </form.Subscribe>

        {/* Seeding */}
        <form.Field name="seeding_method">
          {(field) => (
            <Field>
              <FieldLabel>{t("createTournamentForm.fieldSeedingMethod")}</FieldLabel>
              <div className="flex gap-2">
                {([
                  { value: "random", label: t("createTournamentForm.seedingRandom") },
                  { value: "by_group_score", label: t("createTournamentForm.seedingByGroup") },
                ] as const).map((opt) => (
                  <Button key={opt.value} type="button" size="sm"
                    variant={field.state.value === opt.value ? "default" : "outline"}
                    onClick={() => field.handleChange(opt.value)}>
                    {opt.label}
                  </Button>
                ))}
              </div>
            </Field>
          )}
        </form.Field>

        {/* Team count — sports_day only. Competition adds teams + pairs later and
            assigns them to classes, so no fixed count is required up front. */}
        <form.Subscribe selector={(s) => s.values.mode}>
          {(mode) => mode === "sports_day" ? (
            <form.Field
              name="team_count"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t("createTournamentForm.fieldTeamCount")}</FieldLabel>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {TEAM_COUNT_PRESETS.map((n) => (
                        <Button key={n} type="button" size="sm" className="h-7 text-xs px-2"
                          variant={field.state.value === n ? "default" : "outline"}
                          onClick={() => field.handleChange(n)}>
                          {t("createTournamentForm.presetN", { n })}
                        </Button>
                      ))}
                    </div>
                    <InputGroup>
                      <Input id={field.name} type="number" min={2} max={64} value={field.state.value}
                        onBlur={field.handleBlur} onChange={(e) => field.handleChange(Number(e.target.value))}
                        aria-invalid={isInvalid}
                        className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                      <InputGroupAddon align="inline-end"><InputGroupText>{t("createTournamentForm.addonTeams")}</InputGroupText></InputGroupAddon>
                    </InputGroup>
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            />
          ) : (
            <Field>
              <FieldLabel>{t("createTournamentForm.fieldTeamOrPair")}</FieldLabel>
              <FieldDescription>{t("createTournamentForm.addTeamsLaterDesc")}</FieldDescription>
            </Field>
          )}
        </form.Subscribe>

        <form.Field name="notes">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t("createTournamentForm.fieldNotes")}</FieldLabel>
              <InputGroup>
                <InputGroupTextarea id={field.name} value={field.state.value} onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  rows={3} className="min-h-20 resize-none" placeholder={t("createTournamentForm.placeholderNotes")} />
              </InputGroup>
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      <Field orientation="horizontal" className="mt-6">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting ? t("createTournamentForm.btnCreating") : t("createTournamentForm.btnCreate")}
            </Button>
          )}
        </form.Subscribe>
      </Field>
    </form>
  );
}
