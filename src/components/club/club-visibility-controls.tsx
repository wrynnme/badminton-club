"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Check, Loader2, QrCode, Globe } from "lucide-react";
import dynamic from "next/dynamic";
const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setClubVisibilityAction } from "@/lib/actions/clubs";

/**
 * Owner-only club visibility toggle (settings tab). Off = private (manager-only);
 * on = public read-only at /c/[id] with money hidden. When public, surfaces the
 * stable link + copy + QR. Mirrors tournament ShareControls but a flat flag
 * (no generate/revoke token). Server action enforces owner-only regardless.
 */
export function ClubVisibilityControls({
  clubId,
  isPublic: initial,
  appUrl,
}: {
  clubId: string;
  isPublic: boolean;
  appUrl: string;
}) {
  const [isPublic, setIsPublic] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [isPending, start] = useTransition();

  const shareUrl = `${appUrl}/c/${clubId}`;

  const toggle = (next: boolean) =>
    start(async () => {
      const res = await setClubVisibilityAction(clubId, next);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setIsPublic(next);
      toast.success(next ? "เปิดเป็นสาธารณะแล้ว" : "เปลี่ยนเป็นส่วนตัวแล้ว");
    });

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          การเข้าถึง
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <Checkbox
            checked={isPublic}
            onCheckedChange={(v) => toggle(v === true)}
            disabled={isPending}
            className="mt-0.5"
            aria-label="เปิดให้คนทั่วไปดู"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">เปิดให้คนทั่วไปดู (read-only)</span>
            <span className="block text-xs text-muted-foreground">
              ใครมีลิงก์ก็ดูรายชื่อ / คิว / แดชบอร์ดได้โดยไม่ต้อง login — ไม่เห็นข้อมูลค่าใช้จ่าย
            </span>
          </span>
          {isPending && <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </label>

        {isPublic && (
          <div className="flex gap-2">
            <Input value={shareUrl} readOnly className="h-8 flex-1 font-mono text-xs" />
            <Button size="sm" variant="outline" className="h-8 shrink-0" aria-label="คัดลอกลิงก์" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <Dialog open={qrOpen} onOpenChange={setQrOpen}>
              <DialogTrigger render={<Button size="sm" variant="outline" className="h-8 shrink-0" />}>
                <QrCode className="h-3.5 w-3.5" />
                <span className="sr-only">QR Code</span>
              </DialogTrigger>
              <DialogContent className="sm:max-w-xs">
                <DialogHeader>
                  <DialogTitle>QR Code ลิงก์ก๊วน</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="rounded-md bg-white p-4">
                    <QRCode value={shareUrl} size={240} />
                  </div>
                  <p className="break-all text-center font-mono text-xs text-muted-foreground">{shareUrl}</p>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
