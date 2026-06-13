"use client";

import { fieldErrors } from "@/lib/form-errors";
import * as z from "zod";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addGuestPlayerAction } from "@/lib/actions/club-players";
import type { Level } from "@/lib/types";

const NONE_SENTINEL = "__none__";

type Props = {
  clubId: string;
  full: boolean;
  levels: Level[];
};

/** Owner / co-admin only — adds a guest player (name only, no LINE account). */
export function AddGuestPlayer({ clubId, full, levels }: Props) {
  const t = useTranslations("club.addGuestPlayer");
  const [open, setOpen] = useState(false);

  const formSchema = z.object({
    display_name: z.string().min(1, t("validationName")),
    level_id: z.string(),
    note: z.string(),
  });

  const form = useForm({
    defaultValues: { display_name: "", level_id: NONE_SENTINEL, note: "" },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const level_id = value.level_id && value.level_id !== NONE_SENTINEL ? value.level_id : null;
      const res = await addGuestPlayerAction({
        club_id: clubId,
        display_name: value.display_name,
        note: value.note || null,
        level_id,
      });
      if (res?.error) toast.error(res.error);
      else {
        toast.success(full ? t("toastSuccessReserve") : t("toastSuccessActive"));
        form.reset();
        // keep the form open so multiple guests can be added in a row
      }
    },
  });

  if (!open) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4 mr-1" />
          {t("addPlayerButton")}
        </Button>
        {full && (
          <p className="text-sm text-muted-foreground">{t("fullNote")}</p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      // basis-full: the parent row is flex-wrap (shared with the LINE-import
      // button) — take a full row when expanded so the form isn't squeezed.
      className="border rounded-lg p-4 w-full basis-full"
    >
      <p className="text-sm font-medium mb-3">{t("formTitle")}</p>
      <FieldGroup>
        <form.Field
          name="display_name"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{t("displayNameLabel")}</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder={t("displayNamePlaceholder")}
                  autoFocus
                />
                {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
              </Field>
            );
          }}
        />

        <form.Field
          name="level_id"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t("levelLabel")}</FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(v) => field.handleChange(v ?? NONE_SENTINEL)}
              >
                <SelectTrigger id={field.name} className="w-full">
                  <SelectValue>
                    {(v: string) => {
                      if (!v || v === NONE_SENTINEL) return t("levelNone");
                      return levels.find((l) => l.id === v)?.label ?? t("levelNone");
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_SENTINEL}>{t("levelNone")}</SelectItem>
                  {levels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label} ({l.real})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />

        <form.Field
          name="note"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t("noteLabel")}</FieldLabel>
              <InputGroup>
                <InputGroupTextarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t("notePlaceholder")}
                  rows={2}
                  className="min-h-16 resize-none"
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

      {full && (
        <p className="text-sm text-muted-foreground mt-3">{t("fullNote")}</p>
      )}

      <Field orientation="horizontal" className="mt-4">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? t("submitting") : t("submit")}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" onClick={() => { form.reset(); setOpen(false); }}>
          {t("close")}
        </Button>
      </Field>
    </form>
  );
}
