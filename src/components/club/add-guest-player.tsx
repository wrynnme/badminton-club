"use client";

import { fieldErrors } from "@/lib/form-errors";
import * as z from "zod";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { addGuestPlayerAction } from "@/lib/actions/clubs";

const formSchema = z.object({
  display_name: z.string().min(1, "ระบุชื่อ"),
  level: z.string(),
  note: z.string(),
});

type Props = {
  clubId: string;
  full: boolean;
};

/** Owner / co-admin only — adds a guest player (name only, no LINE account). */
export function AddGuestPlayer({ clubId, full }: Props) {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: { display_name: "", level: "", note: "" },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const res = await addGuestPlayerAction({ club_id: clubId, ...value });
      if (res?.error) toast.error(res.error);
      else {
        toast.success("เพิ่มผู้เล่นแล้ว");
        form.reset();
        // keep the form open so multiple guests can be added in a row
      }
    },
  });

  if (full) {
    return <p className="text-sm text-destructive">ก๊วนเต็มแล้ว — เพิ่มผู้เล่นไม่ได้</p>;
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4 mr-1" />
        เพิ่มผู้เล่น (guest)
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="border rounded-lg p-4"
    >
      <p className="text-sm font-medium mb-3">เพิ่มผู้เล่น (guest) — ไม่ต้องมี LINE</p>
      <FieldGroup>
        <form.Field
          name="display_name"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>ชื่อที่ใช้แสดง *</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="ชื่อเล่นผู้มาเล่น"
                  autoFocus
                />
                {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
              </Field>
            );
          }}
        />

        <form.Field
          name="level"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>ระดับฝีมือ</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="เช่น มือใหม่ / N / S"
              />
            </Field>
          )}
        />

        <form.Field
          name="note"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>หมายเหตุ</FieldLabel>
              <InputGroup>
                <InputGroupTextarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="เช่น เพื่อนของพี่ A"
                  rows={2}
                  className="min-h-16 resize-none"
                />
                <InputGroupAddon align="block-end">
                  <InputGroupText className="tabular-nums">
                    {field.state.value.length} ตัวอักษร
                  </InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          )}
        />
      </FieldGroup>

      <Field orientation="horizontal" className="mt-4">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "กำลังเพิ่ม..." : "เพิ่มผู้เล่น"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" onClick={() => { form.reset(); setOpen(false); }}>
          ปิด
        </Button>
      </Field>
    </form>
  );
}
