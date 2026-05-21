"use client";

import { fieldErrors } from "@/lib/form-errors";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Loader2, X, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { updateTournamentAction } from "@/lib/actions/tournaments";
import type { Tournament, TournamentFormat, SeedingMethod, MatchUnit } from "@/lib/types";

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
  pair_division_thresholds: z.array(z.number()),
  notes: z.string(),
});

const TEAM_COUNT_PRESETS = [4, 6, 8, 12, 16];

function ThresholdChipList({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const [addRaw, setAddRaw] = useState("");
  const [addActive, setAddActive] = useState(false);
  const N = value.length + 1;

  function addThreshold() {
    const n = parseFloat(addRaw);
    if (!Number.isFinite(n)) { setAddRaw(""); setAddActive(false); return; }
    const next = [...new Set([...value, n])].sort((a, b) => a - b);
    onChange(next);
    setAddRaw("");
    setAddActive(false);
  }

  function removeThreshold(t: number) {
    onChange(value.filter((v) => v !== t));
  }

  return (
    <Field>
      <FieldLabel>Thresholds แบ่ง Division</FieldLabel>
      <div className="flex flex-wrap items-center gap-1.5 min-h-8">
        {value.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 pr-1 text-sm font-mono">
            {t}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-4 w-4 p-0 hover:bg-transparent"
              onClick={() => removeThreshold(t)}
            >
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        ))}
        {addActive ? (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              step="0.5"
              autoFocus
              value={addRaw}
              onChange={(e) => setAddRaw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addThreshold(); } if (e.key === "Escape") { setAddRaw(""); setAddActive(false); } }}
              onBlur={addThreshold}
              className="h-7 w-24 text-sm"
              placeholder="เช่น 5"
            />
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs"
            onClick={() => setAddActive(true)}>
            <Plus className="h-3 w-3" /> เพิ่ม threshold
          </Button>
        )}
      </div>
      <FieldDescription>
        → จะแบ่งเป็น {N} Division · threshold เรียงน้อย→มาก เช่น 3,5,7 → 4 Div · pair_level &gt; สูงสุด = D1
      </FieldDescription>
    </Field>
  );
}

export function EditTournamentForm({ tournament, existingTeamCount = 0 }: { tournament: Tournament; existingTeamCount?: number }) {
  const form = useForm({
    defaultValues: {
      name: tournament.name,
      venue: tournament.venue ?? "",
      start_date: tournament.start_date ?? "",
      end_date: tournament.end_date ?? "",
      format: tournament.format as TournamentFormat,
      match_unit: tournament.match_unit as MatchUnit,
      has_lower_bracket: tournament.has_lower_bracket,
      allow_drop_to_lower: tournament.allow_drop_to_lower,
      seeding_method: tournament.seeding_method as SeedingMethod,
      advance_count: tournament.advance_count ?? 2,
      team_count: tournament.team_count,
      pair_division_thresholds: tournament.pair_division_thresholds ?? [],
      notes: tournament.notes ?? "",
    },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const res = await updateTournamentAction({ ...value, id: tournament.id });
      if (res?.error) toast.error(res.error);
      else toast.success("บันทึกแล้ว");
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">ข้อมูลทัวร์นาเมนต์</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
        >
          <FieldGroup>
            <form.Field name="name">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>ชื่อทัวร์นาเมนต์ *</FieldLabel>
                    <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)} aria-invalid={isInvalid} />
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            </form.Field>

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

            <form.Field name="match_unit">
              {(field) => (
                <Field>
                  <FieldLabel>หน่วยการแข่ง *</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: "team", label: "ทีม vs ทีม" },
                      { value: "pair", label: "คู่ vs คู่" },
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

            <form.Subscribe selector={(s) => s.values.match_unit}>
              {(unit) => unit === "pair" && (
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

            <form.Subscribe selector={(s) => s.values.format}>
              {(fmt) => fmt === "group_knockout" && (
                <form.Field name="advance_count">
                  {(field) => (
                    <Field>
                      <FieldLabel>ทีมผ่านรอบต่อกลุ่ม</FieldLabel>
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
                    </Field>
                  )}
                </form.Field>
              )}
            </form.Subscribe>

            <form.Subscribe selector={(s) => s.values.format}>
              {(fmt) => fmt !== "group_only" && (
                <div className="space-y-3 pl-3 border-l-2 border-muted">
                  <form.Field name="has_lower_bracket">
                    {(field) => (
                      <Field orientation="horizontal">
                        <Checkbox id="edit_has_lower_bracket" checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(Boolean(v))} />
                        <div>
                          <FieldLabel htmlFor="edit_has_lower_bracket">มีสายล่าง</FieldLabel>
                        </div>
                      </Field>
                    )}
                  </form.Field>
                  <form.Subscribe selector={(s) => s.values.has_lower_bracket}>
                    {(hasLower) => hasLower && (
                      <form.Field name="allow_drop_to_lower">
                        {(field) => (
                          <Field orientation="horizontal">
                            <Checkbox id="edit_allow_drop_to_lower" checked={field.state.value}
                              onCheckedChange={(v) => field.handleChange(Boolean(v))} />
                            <div>
                              <FieldLabel htmlFor="edit_allow_drop_to_lower">แพ้สายบนลงมาแก้ตัวสายล่างได้</FieldLabel>
                            </div>
                          </Field>
                        )}
                      </form.Field>
                    )}
                  </form.Subscribe>
                </div>
              )}
            </form.Subscribe>

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

            <form.Field name="team_count">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const belowExisting = existingTeamCount > 0 && field.state.value < existingTeamCount;
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
                    {belowExisting && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        มีทีมในระบบ {existingTeamCount} ทีม — ลดจำนวนต่ำกว่านี้ทีมเดิมจะไม่ถูกลบอัตโนมัติ
                      </p>
                    )}
                  </Field>
                );
              }}
            </form.Field>

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

          <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" className="w-full mt-6" disabled={!canSubmit || isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSubmitting ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </CardContent>
    </Card>
  );
}
