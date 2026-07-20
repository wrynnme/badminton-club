"use client";

import { fieldErrors } from "@/lib/form-errors";
import * as React from "react";
import * as z from "zod";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@bprogress/next/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { createClubSeriesAction } from "@/lib/actions/club-series";
import { toDateStr } from "@/lib/utils";

const TIME_PRESETS = [
  { label: "06:00–08:00", start: "06:00", end: "08:00" },
  { label: "07:00–09:00", start: "07:00", end: "09:00" },
  { label: "17:00–19:00", start: "17:00", end: "19:00" },
  { label: "18:00–20:00", start: "18:00", end: "20:00" },
  { label: "19:00–21:00", start: "19:00", end: "21:00" },
  { label: "20:00–22:00", start: "20:00", end: "22:00" },
];

const MAX_PRESETS = [8, 10, 12, 16, 20];

/**
 * CreateSeriesForm — the "จัดก๊วนใหม่" entry point (ADR 0002 decision #8/#12).
 * Submits `createClubSeriesAction`, which creates the persistent `club_series`
 * row + opens its first session in one shot. Replaces the retired
 * `CreateClubForm` + preset system: `club_series.session_defaults` (decision
 * #15) is the living successor of a preset, seeded straight from this form.
 */
export function CreateSeriesForm() {
  const t = useTranslations("club.createForm");
  const router = useRouter();

  const DATE_PRESETS = [
    { label: t("dateToday"), getValue: () => toDateStr(new Date()) },
    { label: t("dateTomorrow"), getValue: () => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateStr(d); } },
    {
      label: t("dateNextSat"), getValue: () => {
        const d = new Date();
        const day = d.getDay();
        d.setDate(d.getDate() + ((6 - day + 7) % 7 || 7));
        return toDateStr(d);
      },
    },
    {
      label: t("dateNextSun"), getValue: () => {
        const d = new Date();
        const day = d.getDay();
        d.setDate(d.getDate() + ((0 - day + 7) % 7 || 7));
        return toDateStr(d);
      },
    },
  ];

  // Mirrors createClubSeriesAction's server zod (src/lib/actions/club-series.ts
  // CreateSeriesSchema + the name/isAdhoc branch below it): name may be empty
  // ONLY when isAdhoc is on (auto-named server-side); a non-empty name must
  // still be >= 2 chars either way.
  const formSchema = z
    .object({
      name: z.string(),
      isAdhoc: z.boolean(),
      venue: z.string(),
      playDate: z.string().min(1, t("validationDate")),
      startTime: z.string().min(1, t("validationStart")),
      endTime: z.string().min(1, t("validationEnd")),
      maxPlayers: z.number().int().min(2, t("validationMaxMin")).max(40, t("validationMaxMax")),
      shuttleInfo: z.string(),
      notes: z.string(),
    })
    .superRefine((values, ctx) => {
      const trimmed = values.name.trim();
      const invalid =
        (trimmed.length > 0 && trimmed.length < 2) || (trimmed.length === 0 && !values.isAdhoc);
      if (invalid) {
        ctx.addIssue({ code: "custom", message: t("validationName"), path: ["name"] });
      }
    });

  const form = useForm({
    defaultValues: {
      name: "",
      isAdhoc: false,
      venue: "",
      playDate: toDateStr(new Date()),
      startTime: "",
      endTime: "",
      maxPlayers: 12,
      shuttleInfo: "",
      notes: "",
    },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const res = await createClubSeriesAction(value);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      router.push(`/clubs/${res.seriesId}/s/${res.clubId}`);
    },
  });

  return (
    <form
      id="create-series-form"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Subscribe selector={(s) => s.values.isAdhoc}>
          {(isAdhoc) => (
            <form.Field
              name="name"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>
                      {isAdhoc ? t("nameLabelOptional") : t("nameLabel")}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                      placeholder={isAdhoc ? t("namePlaceholderAdhoc") : t("namePlaceholder")}
                    />
                    {isInvalid && (
                      <FieldError errors={fieldErrors(field.state.meta.errors)} />
                    )}
                  </Field>
                );
              }}
            />
          )}
        </form.Subscribe>

        <form.Field
          name="isAdhoc"
          children={(field) => (
            <Field orientation="horizontal" className="items-start gap-2">
              <Checkbox
                id={field.name}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(!!checked)}
              />
              <div className="space-y-1">
                <FieldLabel htmlFor={field.name} className="font-normal">
                  {t("adhocToggleLabel")}
                </FieldLabel>
                <FieldDescription>{t("adhocToggleHelper")}</FieldDescription>
              </div>
            </Field>
          )}
        />

        {/* Date field + presets */}
        <form.Field
          name="playDate"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{t("dateLabel")}</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  // Default = toDateStr(new Date()); the server prerender (UTC)
                  // and the client (user's zone) can disagree around midnight —
                  // the client value wins and is the one we want.
                  suppressHydrationWarning
                />
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {DATE_PRESETS.map((p) => (
                    <Button
                      key={p.label}
                      type="button"
                      variant={field.state.value === p.getValue() ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => field.handleChange(p.getValue())}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                {isInvalid && (
                  <FieldError errors={fieldErrors(field.state.meta.errors)} />
                )}
              </Field>
            );
          }}
        />

        {/* Time fields + presets */}
        <form.Subscribe selector={(s) => ({ start: s.values.startTime, end: s.values.endTime })}>
          {({ start, end }) => (
            <Field>
              <FieldLabel>{t("timeLabel")}</FieldLabel>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {TIME_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant={start === p.start && end === p.end ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => {
                      form.setFieldValue("startTime", p.start);
                      form.setFieldValue("endTime", p.end);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2">
                <form.Field
                  name="startTime"
                  children={(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">{t("timeStart")}</FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="time"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          aria-invalid={isInvalid}
                        />
                        {isInvalid && (
                          <FieldError errors={fieldErrors(field.state.meta.errors)} />
                        )}
                      </Field>
                    );
                  }}
                />
                <form.Field
                  name="endTime"
                  children={(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">{t("timeEnd")}</FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="time"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          aria-invalid={isInvalid}
                        />
                        {isInvalid && (
                          <FieldError errors={fieldErrors(field.state.meta.errors)} />
                        )}
                      </Field>
                    );
                  }}
                />
              </div>
            </Field>
          )}
        </form.Subscribe>

        {/* Max players + presets */}
        <form.Field
          name="maxPlayers"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{t("maxPlayersLabel")}</FieldLabel>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {MAX_PRESETS.map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant={field.state.value === n ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => field.handleChange(n)}
                    >
                      {n} {t("maxPlayersSuffix")}
                    </Button>
                  ))}
                </div>
                <InputGroup>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="number"
                    min={2}
                    max={40}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(Number(e.target.value))}
                    aria-invalid={isInvalid}
                    className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{t("maxPlayersSuffix")}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                {isInvalid && (
                  <FieldError errors={fieldErrors(field.state.meta.errors)} />
                )}
              </Field>
            );
          }}
        />

        <form.Field
          name="venue"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t("venueLabel")}</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={t("venuePlaceholder")}
              />
            </Field>
          )}
        />

        <form.Field
          name="shuttleInfo"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t("shuttleLabel")}</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={t("shuttlePlaceholder")}
              />
            </Field>
          )}
        />

        <form.Field
          name="notes"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t("notesLabel")}</FieldLabel>
              <InputGroup>
                <InputGroupTextarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t("notesPlaceholder")}
                  rows={3}
                  className="min-h-20 resize-none"
                />
                <InputGroupAddon align="block-end">
                  <InputGroupText className="tabular-nums">
                    {t("charCount", { count: field.state.value.length })}
                  </InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          )}
        />
      </FieldGroup>

      <Field orientation="horizontal" className="mt-6">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? t("submitting") : t("submit")}
            </Button>
          )}
        </form.Subscribe>
      </Field>
    </form>
  );
}
