"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Link2, Link2Off, Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
          <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="outline" className="h-8 shrink-0 text-destructive hover:text-destructive" onClick={revoke}>
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
