"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Link2, Link2Off, Copy, Check, Loader2, QrCode } from "lucide-react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { generateShareTokenAction, revokeShareTokenAction } from "@/lib/actions/tournaments";

export function ShareControls({
  tournamentId,
  shareToken,
  appUrl,
}: {
  tournamentId: string;
  shareToken: string | null;
  appUrl: string;
}) {
  const [token, setToken] = useState(shareToken);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [isPending, start] = useTransition();

  const shareUrl = token ? `${appUrl}/t/${token}` : null;

  const generate = () =>
    start(async () => {
      const res = await generateShareTokenAction(tournamentId);
      if ("error" in res) { toast.error(res.error); return; }
      setToken(res.token);
      toast.success("สร้างลิงก์แล้ว");
    });

  const revoke = () =>
    start(async () => {
      const res = await revokeShareTokenAction(tournamentId);
      if ("error" in res) { toast.error(res.error); return; }
      setToken(null);
      toast.success("ยกเลิกลิงก์แล้ว");
    });

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-2">
      {shareUrl ? (
        <div className="flex gap-2">
          <Input value={shareUrl} readOnly className="text-xs h-8 flex-1 font-mono" />
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
                <DialogTitle>QR Code สำหรับลิงก์แชร์</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="bg-white p-4 rounded-md">
                  <QRCode value={shareUrl} size={240} />
                </div>
                <p className="text-xs text-muted-foreground break-all text-center font-mono">{shareUrl}</p>
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="h-8 shrink-0 text-destructive hover:text-destructive" aria-label="เพิกถอนลิงก์" onClick={revoke}>
            <Link2Off className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={generate} className="self-start" disabled={isPending}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          {isPending ? "กำลังสร้าง..." : "สร้างลิงก์แชร์"}
        </Button>
      )}
      {shareUrl && (
        <p className="text-xs text-muted-foreground">ลิงก์นี้ดูได้โดยไม่ต้อง login</p>
      )}
    </div>
  );
}
