"use client";

import { fieldErrors } from "@/lib/form-errors";
import * as z from "zod";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserPlus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { addGuestPlayerAction } from "@/lib/actions/club-players";
import type { Level } from "@/lib/types";

const NONE_SENTINEL = "__none__";

type Props = {
  clubId: string;
  full: boolean;
  levels: Level[];
  sessionStart?: string; // "HH:MM:SS" — club window, shown as the time placeholders
  sessionEnd?: string;
};

/** Owner / co-admin only — adds a guest player (name only, no LINE account). */
export function AddGuestPlayer({ clubId, full, levels, sessionStart, sessionEnd }: Props) {
  const t = useTranslations("club.addGuestPlayer");
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const clubStartPlaceholder = sessionStart?.slice(0, 5) ?? "";
  const clubEndPlaceholder = sessionEnd?.slice(0, 5) ?? "";

  const formSchema = z.object({
    display_name: z.string().min(1, t("validationName")),
    level_id: z.string(),
    note: z.string(),
    start_time: z.string(),
    end_time: z.string(),
  });

  const form = useForm({
    defaultValues: { display_name: "", level_id: NONE_SENTINEL, note: "", start_time: "", end_time: "" },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const level_id = value.level_id && value.level_id !== NONE_SENTINEL ? value.level_id : null;
      // Blank (or exactly the club window) = null → use the club window.
      const start_time = value.start_time && value.start_time !== clubStartPlaceholder ? value.start_time : null;
      const end_time = value.end_time && value.end_time !== clubEndPlaceholder ? value.end_time : null;
      const res = await addGuestPlayerAction({
        club_id: clubId,
        display_name: value.display_name,
        note: value.note || null,
        level_id,
        start_time,
        end_time,
      });
      if (res?.error) toast.error(res.error);
      else {
        toast.success(full ? t("toastSuccessReserve") : t("toastSuccessActive"));
        form.reset();
        setShowMore(false);
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

      {/* Progressive disclosure: time window stays hidden so quick multi-add
          keeps showing only name·level·note. */}
      <Collapsible open={showMore} onOpenChange={setShowMore} className="mt-3">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            />
          }
        >
          {t("moreOptions")}
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${showMore ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <form.Field
              name="start_time"
              children={(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={field.name} className="text-xs text-muted-foreground">{t("timeStartLabel")}</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="time"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={clubStartPlaceholder}
                  />
                </div>
              )}
            />
            <form.Field
              name="end_time"
              children={(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={field.name} className="text-xs text-muted-foreground">{t("timeEndLabel")}</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="time"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={clubEndPlaceholder}
                  />
                </div>
              )}
            />
          </div>
          {(clubStartPlaceholder || clubEndPlaceholder) && (
            <p className="text-xs text-muted-foreground mt-2">
              {t("timeHint", { start: clubStartPlaceholder, end: clubEndPlaceholder })}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>

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
        <Button type="button" variant="ghost" onClick={() => { form.reset(); setShowMore(false); setOpen(false); }}>
          {t("close")}
        </Button>
      </Field>
    </form>
  );
}
