"use client";

import { fieldErrors } from "@/lib/form-errors";
import * as React from "react";
import * as z from "zod";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
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
import { updateClubAction } from "@/lib/actions/clubs";
import type { Club } from "@/lib/types";

const TIME_PRESETS = [
  { label: "06–08", start: "06:00", end: "08:00" },
  { label: "07–09", start: "07:00", end: "09:00" },
  { label: "17–19", start: "17:00", end: "19:00" },
  { label: "18–20", start: "18:00", end: "20:00" },
  { label: "19–21", start: "19:00", end: "21:00" },
  { label: "20–22", start: "20:00", end: "22:00" },
];

const MAX_PRESETS = [8, 10, 12, 16, 20];

export function EditClubForm({ club }: { club: Club }) {
  const t = useTranslations("club.editForm");

  const formSchema = z.object({
    name: z.string().min(2, t("validationName")),
    venue: z.string().min(2, t("validationVenue")),
    play_date: z.string().min(1, t("validationDate")),
    start_time: z.string().min(1, t("validationStart")),
    end_time: z.string().min(1, t("validationEnd")),
    max_players: z.number().int().min(2, t("validationMaxMin")).max(40, t("validationMaxMax")),
    shuttle_info: z.string(),
    notes: z.string(),
  });

  const form = useForm({
    defaultValues: {
      name: club.name,
      venue: club.venue,
      play_date: club.play_date,
      start_time: club.start_time.slice(0, 5),
      end_time: club.end_time.slice(0, 5),
      max_players: club.max_players,
      shuttle_info: club.shuttle_info ?? "",
      notes: club.notes ?? "",
    },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const res = await updateClubAction({ id: club.id, ...value });
      if (res?.error) toast.error(res.error);
      else {
        toast.success(t("toastSaved"));
      }
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          id="edit-club-form"
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
                    <FieldLabel htmlFor={field.name}>{t("nameLabel")}</FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                    />
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            />

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
                      aria-invalid={isInvalid}
                    />
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            />

            <form.Field
              name="play_date"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t("dateLabel")}</FieldLabel>
                    <Input
                      id={field.name}
                      type="date"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                    />
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            />

            <form.Subscribe selector={(s) => ({ start: s.values.start_time, end: s.values.end_time })}>
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
                          form.setFieldValue("start_time", p.start);
                          form.setFieldValue("end_time", p.end);
                        }}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <form.Field
                      name="start_time"
                      children={(field) => (
                        <Field>
                          <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">{t("timeStart")}</FieldLabel>
                          <Input id={field.name} type="time" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
                        </Field>
                      )}
                    />
                    <form.Field
                      name="end_time"
                      children={(field) => (
                        <Field>
                          <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">{t("timeEnd")}</FieldLabel>
                          <Input id={field.name} type="time" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
                        </Field>
                      )}
                    />
                  </div>
                </Field>
              )}
            </form.Subscribe>

            <form.Field
              name="max_players"
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
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            />

            <form.Field
              name="shuttle_info"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{t("shuttleLabel")}</FieldLabel>
                  <Input
                    id={field.name}
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
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
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

          <Field orientation="horizontal" className="mt-5">
            <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? t("saving") : t("save")}
                </Button>
              )}
            </form.Subscribe>
          </Field>
        </form>
      </CardContent>
    </Card>
  );
}
