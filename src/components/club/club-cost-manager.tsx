"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateClubCostConfigAction } from "@/lib/actions/clubs";
import type { CourtSplit, ShuttleSplit, GapPolicy } from "@/lib/types";

type Props = {
  clubId: string;
  initial: {
    court_fee: number;
    court_split: CourtSplit;
    shuttle_fee: number;
    shuttle_split: ShuttleSplit;
    shuttle_price: number;
    court_gap_policy: GapPolicy;
  };
};

export function ClubCostManager({ clubId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [courtFee, setCourtFee] = useState(initial.court_fee);
  const [courtSplit, setCourtSplit] = useState<CourtSplit>(initial.court_split);
  const [shuttleFee, setShuttleFee] = useState(initial.shuttle_fee);
  const [shuttleSplit, setShuttleSplit] = useState<ShuttleSplit>(initial.shuttle_split);
  const [shuttlePrice, setShuttlePrice] = useState(initial.shuttle_price);
  const [gapPolicy, setGapPolicy] = useState<GapPolicy>(initial.court_gap_policy);

  function handleSave() {
    startTransition(async () => {
      const res = await updateClubCostConfigAction(clubId, {
        court_fee: courtFee,
        court_split: courtSplit,
        shuttle_fee: shuttleFee,
        shuttle_split: shuttleSplit,
        shuttle_price: shuttlePrice,
        court_gap_policy: gapPolicy,
      });
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success("บันทึกการตั้งค่าค่าใช้จ่ายแล้ว");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ตั้งค่าแบ่งค่าใช้จ่าย</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Court fee */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">ค่าสนาม (บาท)</Label>
          <div className="relative max-w-[140px]">
            <Input
              type="number"
              min={0}
              step={1}
              value={courtFee}
              onChange={(e) => setCourtFee(Math.max(0, Number(e.target.value)))}
              className="pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              ฿
            </span>
          </div>
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={courtSplit === "even" ? "default" : "outline"}
              onClick={() => setCourtSplit("even")}
              className="h-7 text-xs"
            >
              หารเท่า
            </Button>
            <Button
              type="button"
              size="sm"
              variant={courtSplit === "by_time" ? "default" : "outline"}
              onClick={() => setCourtSplit("by_time")}
              className="h-7 text-xs"
            >
              ตามเวลา
            </Button>
          </div>
        </div>

        {/* Gap policy — only visible when court_split === "by_time" */}
        {courtSplit === "by_time" && (
          <div className="space-y-2 pl-3 border-l-2 border-muted">
            <Label className="text-sm font-medium">ช่วงไม่มีคนอยู่ในสนาม</Label>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={gapPolicy === "spread" ? "default" : "outline"}
                onClick={() => setGapPolicy("spread")}
                className="h-7 text-xs"
              >
                เฉลี่ยทุกคน
              </Button>
              <Button
                type="button"
                size="sm"
                variant={gapPolicy === "owner" ? "default" : "outline"}
                onClick={() => setGapPolicy("owner")}
                className="h-7 text-xs"
              >
                เจ้าของจ่าย
              </Button>
              <Button
                type="button"
                size="sm"
                variant={gapPolicy === "ignore" ? "default" : "outline"}
                onClick={() => setGapPolicy("ignore")}
                className="h-7 text-xs"
              >
                ไม่คิด
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              เฉลี่ยทุกคน = แบ่งให้ทุกคน · เจ้าของจ่าย = เจ้าของรับภาระ · ไม่คิด = ตัดช่วงนั้นทิ้ง
            </p>
          </div>
        )}

        {/* Shuttle fee */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">ค่าลูก (บาท)</Label>
          <div className="relative max-w-[140px]">
            <Input
              type="number"
              min={0}
              step={1}
              value={shuttlePrice}
              onChange={(e) => setShuttlePrice(Math.max(0, Number(e.target.value)))}
              className="pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              ฿
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={shuttleSplit === "even" ? "default" : "outline"}
              onClick={() => setShuttleSplit("even")}
              className="h-7 text-xs"
            >
              หารเท่า
            </Button>
            <Button
              type="button"
              size="sm"
              variant={shuttleSplit === "per_match" ? "default" : "outline"}
              onClick={() => setShuttleSplit("per_match")}
              className="h-7 text-xs"
            >
              ต่อลูก
            </Button>
            <Button
              type="button"
              size="sm"
              variant={shuttleSplit === "per_player" ? "default" : "outline"}
              onClick={() => setShuttleSplit("per_player")}
              className="h-7 text-xs"
            >
              ต่อแมตช์
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            ค่าลูกคิดจากลูกที่ใช้ในแต่ละแมตช์ (ปุ่ม +ลูก ในตารางคิว) — ต้องใช้ระบบหมุนคิว. หารเท่า = รวมทุกลูก ÷ ทุกคน · ต่อลูก = ลูกในแมตช์ ÷ คนในแมตช์ · ต่อแมตช์ = แต่ละคนจ่ายเต็มตามลูกที่ใช้ (ไม่หาร).
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          บันทึก
        </Button>
      </CardContent>
    </Card>
  );
}
