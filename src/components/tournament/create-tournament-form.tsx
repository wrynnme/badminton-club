"use client";

import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { createTournamentAction } from "@/lib/actions/tournaments";
import type { TournamentFormat, SeedingMethod, MatchUnit, TournamentMode } from "@/lib/types";
import { fieldErrors } from "@/lib/form-errors";
import { ThresholdChipList } from "./threshold-chip-list";

const formSchema = z.object({
  name: z.string().min(2, "ชื่อสั้นไป"),
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
  team_count: z.number().int().min(2, "อย่างน้อย 2 ทีม").max(64),
  pair_division_thresholds: z.array(z.number()),
  notes: z.string(),
});

const TEAM_COUNT_PRESETS = [4, 6, 8, 12, 16];

export function CreateTournamentForm() {
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
                <FieldLabel htmlFor={field.name}>ชื่อทัวร์นาเมนต์ *</FieldLabel>
                <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)} aria-invalid={isInvalid}
                  placeholder="เช่น กีฬาสีประจำปี 2568" />
                {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
              </Field>
            );
          }}
        />

        <form.Field name="venue">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>สถานที่</FieldLabel>
              <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)} placeholder="ชื่อสนาม / สถานที่" />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-2">
          <form.Field name="start_date">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>วันเริ่ม</FieldLabel>
                <Input id={field.name} type="date" value={field.state.value}
                  onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              </Field>
            )}
          </form.Field>
          <form.Field name="end_date">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>วันจบ</FieldLabel>
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
              <FieldLabel>โหมด *</FieldLabel>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: "sports_day", title: "กีฬาสี", desc: "แบ่งทีม แข่งแบบกลุ่มหรือน็อคเอ้า" },
                  { value: "competition", title: "แข่งขัน", desc: "หลายรุ่น (class) · คู่ vs คู่" },
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
                        {active && <Badge className="text-[10px] px-1.5 py-0">เลือกอยู่</Badge>}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">{opt.desc}</span>
                    </Button>
                  );
                })}
              </div>
              <FieldDescription>
                {field.state.value === "competition"
                  ? "หลายรุ่น (class) แบบคู่ vs คู่ — กำหนด class แต่ละรุ่นในแท็บ “ตั้งค่า” หลังสร้าง"
                  : "กีฬาสี / ทั่วไป — เลือกหน่วยเป็นทีม หรือ คู่ (แบ่ง division ได้)"}
              </FieldDescription>
            </Field>
          )}
        </form.Field>

        {/* Format */}
        <form.Field name="format">
          {(field) => (
            <Field>
              <FieldLabel>รูปแบบการแข่ง *</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: "group_only", label: "แบ่งกลุ่ม" },
                  { value: "group_knockout", label: "แบ่งกลุ่ม + น็อคเอ้า" },
                  { value: "knockout_only", label: "น็อคเอ้า" },
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
                  <FieldLabel>หน่วยการแข่ง *</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: "team", label: "ทีม vs ทีม", desc: "ทั้งทีมเป็นหน่วยเดียว" },
                      { value: "pair", label: "คู่ vs คู่", desc: "จับคู่ภายในทีม แข่งข้ามทีม" },
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
                      ? "เจ้าของจัดคู่ภายในทีม → กำหนดการแข่งระหว่างคู่จากต่างทีม"
                      : "ทีมแข่งเต็มทีมโดยตรง (เหมาะกับกีฬาเป็นทีม)"}
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
          ) : (
            <Field>
              <FieldLabel>หน่วยการแข่ง</FieldLabel>
              <FieldDescription>คู่ vs คู่ (กำหนดอัตโนมัติสำหรับ Competition)</FieldDescription>
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
                  <FieldLabel htmlFor={field.name}>ทีมผ่านรอบต่อกลุ่ม</FieldLabel>
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
                  <FieldDescription>จำนวนทีมที่เข้ารอบน็อคเอ้าจากแต่ละกลุ่ม</FieldDescription>
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
                      <FieldLabel htmlFor="has_lower_bracket">มีสายล่าง</FieldLabel>
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
                          <FieldLabel htmlFor="allow_drop_to_lower">แพ้สายบนลงมาแก้ตัวสายล่างได้</FieldLabel>
                          <FieldDescription>default: ไม่อนุญาต</FieldDescription>
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
              <FieldLabel>วิธีแบ่งสาย</FieldLabel>
              <div className="flex gap-2">
                {([
                  { value: "random", label: "จับฉลาก" },
                  { value: "by_group_score", label: "ตามคะแนนรอบกลุ่ม" },
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

        {/* Team count */}
        <form.Field
          name="team_count"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>จำนวนทีม *</FieldLabel>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {TEAM_COUNT_PRESETS.map((n) => (
                    <Button key={n} type="button" size="sm" className="h-7 text-xs px-2"
                      variant={field.state.value === n ? "default" : "outline"}
                      onClick={() => field.handleChange(n)}>
                      {n} ทีม
                    </Button>
                  ))}
                </div>
                <InputGroup>
                  <Input id={field.name} type="number" min={2} max={64} value={field.state.value}
                    onBlur={field.handleBlur} onChange={(e) => field.handleChange(Number(e.target.value))}
                    aria-invalid={isInvalid}
                    className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  <InputGroupAddon align="inline-end"><InputGroupText>ทีม</InputGroupText></InputGroupAddon>
                </InputGroup>
                {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
              </Field>
            );
          }}
        />

        <form.Field name="notes">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>หมายเหตุ</FieldLabel>
              <InputGroup>
                <InputGroupTextarea id={field.name} value={field.state.value} onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  rows={3} className="min-h-20 resize-none" placeholder="กติกา, วิธีตัดสิน ฯลฯ" />
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
              {isSubmitting ? "กำลังสร้าง..." : "สร้างทัวร์นาเมนต์"}
            </Button>
          )}
        </form.Subscribe>
      </Field>
    </form>
  );
}
