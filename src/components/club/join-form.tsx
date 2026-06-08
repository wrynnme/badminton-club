"use client";

import { fieldErrors } from "@/lib/form-errors";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { joinClubAction } from "@/lib/actions/clubs";
import type { Level } from "@/lib/types";

const NONE_SENTINEL = "__none__";

const formSchema = z.object({
  display_name: z.string().min(2, "ชื่อสั้นไป"),
  level_id: z.string(),
  note: z.string(),
});

type Props = {
  clubId: string;
  defaultName: string;
  full: boolean;
  alreadyJoined: boolean;
  levels: Level[];
};

export function JoinForm({ clubId, defaultName, full, alreadyJoined, levels }: Props) {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      display_name: defaultName,
      level_id: NONE_SENTINEL,
      note: "",
    },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const level_id = value.level_id && value.level_id !== NONE_SENTINEL ? value.level_id : null;
      const res = await joinClubAction({
        club_id: clubId,
        display_name: value.display_name,
        note: value.note || null,
        level_id,
      });
      if (res?.error) toast.error(res.error);
      else {
        toast.success(full ? "เพิ่มเป็นสำรองแล้ว (รอคิว)" : "ลงชื่อสำเร็จ");
        setOpen(false);
      }
    },
  });

  if (alreadyJoined) {
    return <p className="text-sm text-green-600 font-medium">✓ คุณลงชื่อไว้แล้ว</p>;
  }
  if (!open) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button onClick={() => setOpen(true)}>ลงชื่อเล่น</Button>
        {full && (
          <p className="text-sm text-muted-foreground">เต็มแล้ว — เพิ่มเป็นสำรอง (รอคิว)</p>
        )}
      </div>
    );
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
                  <FieldError errors={fieldErrors(field.state.meta.errors)} />
                )}
              </Field>
            );
          }}
        />

        <form.Field
          name="level_id"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>ระดับฝีมือ</FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(v) => field.handleChange(v ?? NONE_SENTINEL)}
              >
                <SelectTrigger id={field.name} className="w-full">
                  <SelectValue>
                    {(v: string) => {
                      if (!v || v === NONE_SENTINEL) return "— ไม่ระบุ —";
                      return levels.find((l) => l.id === v)?.label ?? "— ไม่ระบุ —";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_SENTINEL}>— ไม่ระบุ —</SelectItem>
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

      {full && (
        <p className="text-sm text-muted-foreground mt-3">เต็มแล้ว — เพิ่มเป็นสำรอง (รอคิว)</p>
      )}

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
