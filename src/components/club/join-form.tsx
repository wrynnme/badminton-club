"use client";

import { useState, useTransition } from "react";
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
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  if (alreadyJoined) {
    return (
      <p className="text-sm text-green-600 font-medium">✓ คุณลงชื่อไว้แล้ว</p>
    );
  }
  if (full) {
    return <p className="text-sm text-destructive">ก๊วนเต็มแล้ว</p>;
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>ลงชื่อเล่น</Button>;
  }

  return (
    <form
      action={(fd) => {
        start(async () => {
          const res = await joinClubAction(fd);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("ลงชื่อสำเร็จ");
            setOpen(false);
          }
        });
      }}
      className="space-y-3 border rounded-lg p-4"
    >
      <input type="hidden" name="club_id" value={clubId} />
      <div>
        <Label htmlFor="display_name">ชื่อที่ใช้แสดง *</Label>
        <Input id="display_name" name="display_name" defaultValue={defaultName} required minLength={2} />
      </div>
      <div>
        <Label htmlFor="level">ระดับฝีมือ</Label>
        <Input id="level" name="level" placeholder="เช่น มือใหม่ / N / S" />
      </div>
      <div>
        <Label htmlFor="note">หมายเหตุ</Label>
        <Textarea id="note" name="note" rows={2} placeholder="เช่น อาจมาสาย 30 นาที" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "กำลังบันทึก..." : "ยืนยัน"}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>ยกเลิก</Button>
      </div>
    </form>
  );
}
