"use client";

import * as React from "react";
import * as z from "zod";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { joinClubAction } from "@/lib/actions/clubs";

const formSchema = z.object({
  display_name: z.string().min(2, "ชื่อสั้นไป"),
  level: z.string(),
  note: z.string(),
});

type Props = {
  clubId: string;
  defaultName: string;
  full: boolean;
  alreadyJoined: boolean;
};

export function JoinForm({ clubId, defaultName, full, alreadyJoined }: Props) {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      display_name: defaultName,
      level: "",
      note: "",
    },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const res = await joinClubAction({ club_id: clubId, ...value });
      if (res?.error) toast.error(res.error);
      else {
        toast.success("ลงชื่อสำเร็จ");
        setOpen(false);
      }
    },
  });

  if (alreadyJoined) {
    return <p className="text-sm text-green-600 font-medium">✓ คุณลงชื่อไว้แล้ว</p>;
  }
  if (full) {
    return <p className="text-sm text-destructive">ก๊วนเต็มแล้ว</p>;
  }
  if (!open) {
    return <Button onClick={() => setOpen(true)}>ลงชื่อเล่น</Button>;
  }

  return (
    <form
      id="join-club-form"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="border rounded-lg p-4"
    >
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
                />
                {isInvalid && (
                  <FieldError errors={field.state.meta.errors.map((e) => ({ message: String(e) }))} />
                )}
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
                  placeholder="เช่น อาจมาสาย 30 นาที"
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
              {isSubmitting ? "กำลังบันทึก..." : "ยืนยัน"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          ยกเลิก
        </Button>
      </Field>
    </form>
  );
}
