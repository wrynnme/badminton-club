"use client";

import { useEffect, useState, type ReactNode } from "react";
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
 * Self-contained read-only share-link row: resolves the link host from `appUrl`
 * (falling back to the live `window.location.origin` when NEXT_PUBLIC_APP_URL is
 * unset — in an effect so SSR and the first client render match, no hydration
 * mismatch), then renders link Input + copy + QR dialog inside its own flex row.
 * `trailing` slots extra controls (e.g. a revoke button) after the QR button.
 * Shared by ClubVisibilityControls and the tournament ShareControls.
 */
export function ShareLinkRow({
  appUrl,
  path,
  qrTitle,
  trailing,
}: {
  appUrl: string;
  /** Path appended to the resolved origin, e.g. `/c/<id>` or `/t/<token>`. */
  path: string;
  qrTitle: string;
  trailing?: ReactNode;
}) {
  const [origin, setOrigin] = useState(appUrl);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    if (!appUrl && typeof window !== "undefined") setOrigin(window.location.origin);
  }, [appUrl]);

  const url = `${origin}${path}`;

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
    <div className="flex gap-2">
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
      {trailing}
    </div>
  );
}
