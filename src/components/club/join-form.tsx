"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { joinClubAction } from "@/lib/actions/clubs";

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
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-3 border rounded-lg p-4"
    >
      <form.Field
        name="display_name"
        validators={{ onChange: ({ value }) => value.length < 2 ? "ชื่อสั้นไป" : undefined }}
      >
        {(field) => (
          <div>
            <Label htmlFor={field.name}>ชื่อที่ใช้แสดง *</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors[0] && (
              <p className="text-destructive text-xs mt-1">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="level">
        {(field) => (
          <div>
            <Label htmlFor={field.name}>ระดับฝีมือ</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="เช่น มือใหม่ / N / S"
            />
          </div>
        )}
      </form.Field>

      <form.Field name="note">
        {(field) => (
          <div>
            <Label htmlFor={field.name}>หมายเหตุ</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              rows={2}
              placeholder="เช่น อาจมาสาย 30 นาที"
            />
          </div>
        )}
      </form.Field>

      <div className="flex gap-2">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "กำลังบันทึก..." : "ยืนยัน"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>ยกเลิก</Button>
      </div>
    </form>
  );
}
