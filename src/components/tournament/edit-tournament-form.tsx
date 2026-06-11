"use client";

import { fieldErrors } from "@/lib/form-errors";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, ArrowUpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { updateTournamentAction } from "@/lib/actions/tournaments";
import { upgradeToCompetitionAction } from "@/lib/actions/classes";
import type { Tournament, TournamentFormat, SeedingMethod, MatchUnit } from "@/lib/types";
import { ThresholdChipList } from "./threshold-chip-list";

const TEAM_COUNT_PRESETS = [4, 6, 8, 12, 16];

export function EditTournamentForm({ tournament, existingTeamCount = 0, isOwner = false }: { tournament: Tournament; existingTeamCount?: number; isOwner?: boolean }) {
  const t = useTranslations("tournament");
  const [upgrading, startUpgrade] = useTransition();

  const formSchema = z.object({
    name: z.string().min(2, t("createTournamentForm.errorNameTooShort")),
    venue: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    format: z.enum(["group_only", "group_knockout", "knockout_only"]),
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
      name: tournament.name,
      venue: tournament.venue ?? "",
      start_date: tournament.start_date ?? "",
      end_date: tournament.end_date ?? "",
      format: tournament.format as TournamentFormat,
      match_unit: tournament.match_unit as MatchUnit,
      has_lower_bracket: tournament.has_lower_bracket,
      allow_drop_to_lower: tournament.allow_drop_to_lower,
      seeding_method: tournament.seeding_method as SeedingMethod,
      advance_count: tournament.advance_count ?? 2,
      team_count: tournament.team_count,
      pair_division_thresholds: tournament.pair_division_thresholds ?? [],
      notes: tournament.notes ?? "",
    },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const res = await updateTournamentAction({ ...value, id: tournament.id });
      if (res?.error) toast.error(res.error);
      else toast.success(t("editTournamentForm.toastSaved"));
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("editTournamentForm.cardTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Mode — competition is a one-way upgrade (no downgrade) */}
        {tournament.mode === "competition" ? (
          <div className="mb-4 flex items-center gap-2 text-sm">
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">Competition mode</Badge>
            <span className="text-xs text-muted-foreground">{t("editTournamentForm.competitionBadge")}</span>
          </div>
        ) : isOwner && tournament.match_unit === "pair" ? (
          <div className="mb-4 rounded-md border border-dashed p-3 space-y-2">
            <p className="text-sm font-medium">{t("editTournamentForm.upgradeTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("editTournamentForm.upgradeDesc")}
            </p>
            <Button type="button" size="sm" variant="outline" disabled={upgrading}
              onClick={() => {
                if (!confirm(t("editTournamentForm.upgradeConfirm"))) return;
                startUpgrade(async () => {
                  const res = await upgradeToCompetitionAction(tournament.id);
                  if ("error" in res) toast.error(res.error);
                  else toast.success(t("editTournamentForm.toastUpgraded"));
                });
              }}>
              {upgrading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />}
              {t("editTournamentForm.btnUpgrade")}
            </Button>
          </div>
        ) : null}
        <form
          onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
        >
          <FieldGroup>
            <form.Field name="name">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t("createTournamentForm.fieldName")}</FieldLabel>
                    <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)} aria-invalid={isInvalid} />
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            </form.Field>

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

            {/* Competition is locked to pair vs pair — switching to team would drop
                the คู่/class tabs and corrupt the pair-keyed competitor map. */}
            {tournament.mode === "competition" ? (
              <Field>
                <FieldLabel>{t("createTournamentForm.fieldMatchUnit")}</FieldLabel>
                <FieldDescription>{t("editTournamentForm.unitLockedPair")}</FieldDescription>
              </Field>
            ) : (
              <form.Field name="match_unit">
                {(field) => (
                  <Field>
                    <FieldLabel>{t("createTournamentForm.fieldMatchUnit")}</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { value: "team", label: t("createTournamentForm.unitTeamVsTeam") },
                        { value: "pair", label: t("createTournamentForm.unitPairVsPair") },
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
            )}

            {/* Division thresholds — sports_day pair mode only (competition uses classes) */}
            <form.Subscribe selector={(s) => s.values.match_unit}>
              {(unit) => unit === "pair" && tournament.mode !== "competition" && (
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

            <form.Subscribe selector={(s) => s.values.format}>
              {(fmt) => fmt === "group_knockout" && (
                <form.Field name="advance_count">
                  {(field) => (
                    <Field>
                      <FieldLabel>{t("createTournamentForm.fieldAdvanceCount")}</FieldLabel>
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
                    </Field>
                  )}
                </form.Field>
              )}
            </form.Subscribe>

            <form.Subscribe selector={(s) => s.values.format}>
              {(fmt) => fmt !== "group_only" && (
                <div className="space-y-3 pl-3 border-l-2 border-muted">
                  <form.Field name="has_lower_bracket">
                    {(field) => (
                      <Field orientation="horizontal">
                        <Checkbox id="edit_has_lower_bracket" checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(Boolean(v))} />
                        <div>
                          <FieldLabel htmlFor="edit_has_lower_bracket">{t("createTournamentForm.hasLowerBracket")}</FieldLabel>
                        </div>
                      </Field>
                    )}
                  </form.Field>
                  <form.Subscribe selector={(s) => s.values.has_lower_bracket}>
                    {(hasLower) => hasLower && (
                      <form.Field name="allow_drop_to_lower">
                        {(field) => (
                          <Field orientation="horizontal">
                            <Checkbox id="edit_allow_drop_to_lower" checked={field.state.value}
                              onCheckedChange={(v) => field.handleChange(Boolean(v))} />
                            <div>
                              <FieldLabel htmlFor="edit_allow_drop_to_lower">{t("createTournamentForm.allowDropToLower")}</FieldLabel>
                            </div>
                          </Field>
                        )}
                      </form.Field>
                    )}
                  </form.Subscribe>
                </div>
              )}
            </form.Subscribe>

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

            <form.Field name="team_count">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const belowExisting = existingTeamCount > 0 && field.state.value < existingTeamCount;
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
                    {belowExisting && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {t("editTournamentForm.teamCountWarning", { count: existingTeamCount })}
                      </p>
                    )}
                  </Field>
                );
              }}
            </form.Field>

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

          <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" className="w-full mt-6" disabled={!canSubmit || isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSubmitting ? t("editTournamentForm.btnSaving") : t("editTournamentForm.btnSave")}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </CardContent>
    </Card>
  );
}
