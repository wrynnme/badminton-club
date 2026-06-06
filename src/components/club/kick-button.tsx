"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserMinus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { kickPlayerAction } from "@/lib/actions/clubs";

export function KickButton({
  clubId,
  playerId,
  playerName,
}: {
  clubId: string;
  playerId: string;
  playerName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function handleConfirm() {
    start(async () => {
      const fd = new FormData();
      fd.set("club_id", clubId);
      fd.set("player_id", playerId);
      const res = await kickPlayerAction(fd);
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success("ลบผู้เล่นออกจากก๊วนแล้ว");
        setOpen(false);
      }
    });
  }

  const who = playerName ? `“${playerName}”` : "ผู้เล่นคนนี้";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            aria-label="ลบผู้เล่นออกจากก๊วน"
          >
            <UserMinus className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            ลบ {who} ออกจากก๊วน?
          </DialogTitle>
          <DialogDescription>การลบจะมีผลดังนี้:</DialogDescription>
        </DialogHeader>

        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>แมตช์ทั้งหมดที่ผู้เล่นนี้อยู่ (รอแข่ง / กำลังแข่ง / จบแล้ว) จะถูก<span className="text-foreground font-medium">ลบไปด้วย</span></li>
          <li>ถ้าถูกล็อคคู่ไว้ คู่นั้นจะถูกปล่อยอัตโนมัติ</li>
          <li>จะถูกถอดออกจากการหารค่าใช้จ่าย (ค่าสนาม / ค่าลูก / รายการที่ระบุชื่อ)</li>
          <li>จำนวนเกมที่นับให้ผู้เล่นคนอื่นไปแล้วจะไม่เปลี่ยน</li>
        </ul>
        <p className="text-sm font-medium text-destructive">ลบถาวร — ย้อนกลับไม่ได้</p>

        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" disabled={pending}>ยกเลิก</Button>}
          />
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? "กำลังลบ…" : "ลบผู้เล่น"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
