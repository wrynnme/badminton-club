"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClubAction } from "@/lib/actions/clubs";

export function CreateClubForm() {
  const [pending, start] = useTransition();
  return (
    <form
      action={(fd) =>
        start(async () => {
          const res = await createClubAction(fd);
          if (res?.error) toast.error(res.error);
        })
      }
      className="space-y-4"
    >
      <div>
        <Label htmlFor="name">ชื่อก๊วน *</Label>
        <Input id="name" name="name" required minLength={2} placeholder="เช่น ก๊วนรัชดา ทุกพุธ" />
      </div>
      <div>
        <Label htmlFor="venue">สนาม *</Label>
        <Input id="venue" name="venue" required placeholder="ชื่อสนาม / ที่อยู่" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label htmlFor="play_date">วันที่ *</Label>
          <Input id="play_date" name="play_date" type="date" required />
        </div>
        <div>
          <Label htmlFor="start_time">เริ่ม *</Label>
          <Input id="start_time" name="start_time" type="time" required />
        </div>
        <div>
          <Label htmlFor="end_time">เลิก *</Label>
          <Input id="end_time" name="end_time" type="time" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="max_players">รับสูงสุด *</Label>
          <Input id="max_players" name="max_players" type="number" min={2} max={40} defaultValue={12} required />
        </div>
        <div>
          <Label htmlFor="cost_per_person">ค่าก๊วน/คน (บาท)</Label>
          <Input id="cost_per_person" name="cost_per_person" type="number" min={0} step="0.01" defaultValue={0} />
        </div>
      </div>
      <div>
        <Label htmlFor="shuttle_info">ลูกขนไก่</Label>
        <Input id="shuttle_info" name="shuttle_info" placeholder="เช่น Yonex AS-30 / RSL Classic" />
      </div>
      <div>
        <Label htmlFor="notes">หมายเหตุ</Label>
        <Textarea id="notes" name="notes" placeholder="ระดับฝีมือ, กติกา, ที่จอดรถ ฯลฯ" rows={3} />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "กำลังสร้าง..." : "สร้างก๊วน"}
      </Button>
    </form>
  );
}
