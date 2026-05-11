"use client";

import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClubAction } from "@/lib/actions/clubs";

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
    onSubmit: async ({ value }) => {
      const res = await createClubAction(value);
      if (res?.error) toast.error(res.error);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field
        name="name"
        validators={{ onChange: ({ value }) => value.length < 2 ? "ชื่อก๊วนสั้นไป" : undefined }}
      >
        {(field) => (
          <div>
            <Label htmlFor={field.name}>ชื่อก๊วน *</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="เช่น ก๊วนรัชดา ทุกพุธ"
            />
            {field.state.meta.errors[0] && (
              <p className="text-destructive text-xs mt-1">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field
        name="venue"
        validators={{ onChange: ({ value }) => value.length < 2 ? "ระบุสนาม" : undefined }}
      >
        {(field) => (
          <div>
            <Label htmlFor={field.name}>สนาม *</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="ชื่อสนาม / ที่อยู่"
            />
            {field.state.meta.errors[0] && (
              <p className="text-destructive text-xs mt-1">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <div className="grid grid-cols-3 gap-2">
        <form.Field name="play_date" validators={{ onChange: ({ value }) => !value ? "ระบุวันที่" : undefined }}>
          {(field) => (
            <div>
              <Label htmlFor={field.name}>วันที่ *</Label>
              <Input
                id={field.name}
                type="date"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </div>
          )}
        </form.Field>

        <form.Field name="start_time" validators={{ onChange: ({ value }) => !value ? "ระบุเวลาเริ่ม" : undefined }}>
          {(field) => (
            <div>
              <Label htmlFor={field.name}>เริ่ม *</Label>
              <Input
                id={field.name}
                type="time"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </div>
          )}
        </form.Field>

        <form.Field name="end_time" validators={{ onChange: ({ value }) => !value ? "ระบุเวลาเลิก" : undefined }}>
          {(field) => (
            <div>
              <Label htmlFor={field.name}>เลิก *</Label>
              <Input
                id={field.name}
                type="time"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </div>
          )}
        </form.Field>
      </div>

      <form.Field
        name="max_players"
        validators={{ onChange: ({ value }) => (value < 2 || value > 40) ? "2–40 คน" : undefined }}
      >
        {(field) => (
          <div>
            <Label htmlFor={field.name}>รับสูงสุด *</Label>
            <Input
              id={field.name}
              type="number"
              min={2}
              max={40}
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors[0] && (
              <p className="text-destructive text-xs mt-1">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="shuttle_info">
        {(field) => (
          <div>
            <Label htmlFor={field.name}>ลูกขนไก่</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="เช่น Yonex AS-30 / RSL Classic"
            />
          </div>
        )}
      </form.Field>

      <form.Field name="notes">
        {(field) => (
          <div>
            <Label htmlFor={field.name}>หมายเหตุ</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="ระดับฝีมือ, กติกา, ที่จอดรถ ฯลฯ"
              rows={3}
            />
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? "กำลังสร้าง..." : "สร้างก๊วน"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
