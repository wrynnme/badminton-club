"use client";

import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { createTournamentAction } from "@/lib/actions/tournaments";
import type { TournamentFormat, SeedingMethod, MatchUnit } from "@/lib/types";

const formSchema = z.object({
  name: z.string().min(2, "ชื่อสั้นไป"),
  venue: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  format: z.enum(["group_only", "group_knockout", "knockout_only"]),
  match_unit: z.enum(["team", "pair"]),
  has_lower_bracket: z.boolean(),
  allow_drop_to_lower: z.boolean(),
  seeding_method: z.enum(["random", "by_group_score"]),
  advance_count: z.number().int().min(1).max(8),
  team_count: z.number().int().min(2, "อย่างน้อย 2 ทีม").max(64),
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
      match_unit: "team" as MatchUnit,
      has_lower_bracket: false,
      allow_drop_to_lower: false,
      seeding_method: "random" as SeedingMethod,
      advance_count: 2,
      team_count: 4,
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
                {isInvalid && <FieldError errors={field.state.meta.errors.map(e => ({ message: String(e) }))} />}
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

        {/* Format */}
        <form.Field name="format">
          {(field) => (
            <Field>
              <FieldLabel>รูปแบบการแข่ง *</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: "group_only", label: "แบ่งกลุ่ม" },
                  { value: "group_knockout", label: "แบ่งกลุ่ม + Knockout" },
                  { value: "knockout_only", label: "Knockout" },
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

        {/* Match unit */}
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
                  <FieldDescription>จำนวนทีมที่เข้ารอบ knockout จากแต่ละกลุ่ม</FieldDescription>
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
                      <FieldLabel htmlFor="has_lower_bracket">มีสายล่าง (Lower bracket)</FieldLabel>
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
                {isInvalid && <FieldError errors={field.state.meta.errors.map(e => ({ message: String(e) }))} />}
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
              {isSubmitting ? "กำลังสร้าง..." : "สร้างทัวร์นาเมนต์"}
            </Button>
          )}
        </form.Subscribe>
      </Field>
    </form>
  );
}
