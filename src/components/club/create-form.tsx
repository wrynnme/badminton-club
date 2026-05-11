"use client";

import * as React from "react";
import * as z from "zod";
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
import { createClubAction } from "@/lib/actions/clubs";

const formSchema = z.object({
  name: z.string().min(2, "ชื่อก๊วนสั้นไป"),
  venue: z.string().min(2, "ระบุสนาม"),
  play_date: z.string().min(1, "ระบุวันที่"),
  start_time: z.string().min(1, "ระบุเวลาเริ่ม"),
  end_time: z.string().min(1, "ระบุเวลาเลิก"),
  max_players: z.number().int().min(2, "อย่างน้อย 2 คน").max(40, "สูงสุด 40 คน"),
  shuttle_info: z.string(),
  notes: z.string(),
});

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

const DATE_PRESETS = [
  { label: "วันนี้", getValue: () => toDateStr(new Date()) },
  { label: "พรุ่งนี้", getValue: () => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateStr(d); } },
  {
    label: "เสาร์หน้า", getValue: () => {
      const d = new Date();
      const day = d.getDay();
      d.setDate(d.getDate() + ((6 - day + 7) % 7 || 7));
      return toDateStr(d);
    },
  },
  {
    label: "อาทิตย์หน้า", getValue: () => {
      const d = new Date();
      const day = d.getDay();
      d.setDate(d.getDate() + ((0 - day + 7) % 7 || 7));
      return toDateStr(d);
    },
  },
];

const TIME_PRESETS = [
  { label: "06:00–08:00", start: "06:00", end: "08:00" },
  { label: "07:00–09:00", start: "07:00", end: "09:00" },
  { label: "17:00–19:00", start: "17:00", end: "19:00" },
  { label: "18:00–20:00", start: "18:00", end: "20:00" },
  { label: "19:00–21:00", start: "19:00", end: "21:00" },
  { label: "20:00–22:00", start: "20:00", end: "22:00" },
];

const MAX_PRESETS = [8, 10, 12, 16, 20];

export function CreateClubForm() {
  const form = useForm({
    defaultValues: {
      name: "",
      venue: "",
      play_date: "",
      start_time: "",
      end_time: "",
      max_players: 12,
      shuttle_info: "",
      notes: "",
    },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const res = await createClubAction(value);
      if (res?.error) toast.error(res.error);
    },
  });

  return (
    <form
      id="create-club-form"
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
                <FieldLabel htmlFor={field.name}>ชื่อก๊วน *</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="เช่น ก๊วนรัชดา ทุกพุธ"
                />
                {isInvalid && (
                  <FieldError errors={field.state.meta.errors.map((e) => ({ message: String(e) }))} />
                )}
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
                <FieldLabel htmlFor={field.name}>สนาม *</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="ชื่อสนาม / ที่อยู่"
                />
                {isInvalid && (
                  <FieldError errors={field.state.meta.errors.map((e) => ({ message: String(e) }))} />
                )}
              </Field>
            );
          }}
        />

        {/* Date field + presets */}
        <form.Field
          name="play_date"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>วันที่ *</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
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
                  <FieldError errors={field.state.meta.errors.map((e) => ({ message: String(e) }))} />
                )}
              </Field>
            );
          }}
        />

        {/* Time fields + presets */}
        <form.Subscribe selector={(s) => ({ start: s.values.start_time, end: s.values.end_time })}>
          {({ start, end }) => (
            <Field>
              <FieldLabel>เวลา *</FieldLabel>
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
              <div className="grid grid-cols-2 gap-2">
                <form.Field
                  name="start_time"
                  children={(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">เริ่ม</FieldLabel>
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
                          <FieldError errors={field.state.meta.errors.map((e) => ({ message: String(e) }))} />
                        )}
                      </Field>
                    );
                  }}
                />
                <form.Field
                  name="end_time"
                  children={(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">เลิก</FieldLabel>
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
                          <FieldError errors={field.state.meta.errors.map((e) => ({ message: String(e) }))} />
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
          name="max_players"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>รับสูงสุด *</FieldLabel>
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
                      {n} คน
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
                    <InputGroupText>คน</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                {isInvalid && (
                  <FieldError errors={field.state.meta.errors.map((e) => ({ message: String(e) }))} />
                )}
              </Field>
            );
          }}
        />

        <form.Field
          name="shuttle_info"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>ลูกขนไก่</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="เช่น Yonex AS-30 / RSL Classic"
              />
            </Field>
          )}
        />

        <form.Field
          name="notes"
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
                  placeholder="ระดับฝีมือ, กติกา, ที่จอดรถ ฯลฯ"
                  rows={3}
                  className="min-h-20 resize-none"
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

      <Field orientation="horizontal" className="mt-6">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "กำลังสร้าง..." : "สร้างก๊วน"}
            </Button>
          )}
        </form.Subscribe>
      </Field>
    </form>
  );
}
