"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check, QrCode } from "lucide-react";
import dynamic from "next/dynamic";
const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Read-only share-link row: link Input + copy button + QR-code dialog. Renders as
 * a fragment (no wrapper) so a caller can place it in its own flex row and append
 * extra controls (e.g. a revoke button). Shared by ClubVisibilityControls and the
 * tournament ShareControls.
 */
export function ShareLinkRow({ url, qrTitle }: { url: string; qrTitle: string }) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("คัดลอกไม่สำเร็จ — คัดลอกลิงก์ด้วยตนเอง");
    }
  };

  return (
    <>
      <Input value={url} readOnly className="h-8 flex-1 font-mono text-xs" />
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
            <DialogTitle>{qrTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="rounded-md bg-white p-4">
              <QRCode value={url} size={240} />
            </div>
            <p className="break-all text-center font-mono text-xs text-muted-foreground">{url}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
