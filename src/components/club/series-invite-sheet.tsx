"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { Check, Copy, Loader2, Share2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { generateSeriesJoinTokenAction } from "@/lib/actions/club-linking";

const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });

/**
 * "ชวนเพื่อน" sheet (flow Step 2, 2026-07-21) — surfaces the EXISTING join-link
 * machinery (generateSeriesJoinTokenAction + /clubs/join/[token]) as a one-tap
 * dialog: link + copy + share-to-LINE + inline QR. No new actions, no new
 * permissions — the deep copy in ตั้งค่า stays where it was; this is a shortcut.
 * Rendered only for managers (call sites gate on canManage).
 */
export function SeriesInviteSheet({
  seriesId,
  joinToken,
  appUrl,
  triggerLabel,
  triggerVariant = "outline",
}: {
  seriesId: string;
  joinToken: string | null;
  appUrl: string;
  triggerLabel: string;
  triggerVariant?: "outline" | "default" | "secondary";
}) {
  const t = useTranslations("club.inviteSheet");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [token, setToken] = useState(joinToken);
  const [origin, setOrigin] = useState(appUrl);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!appUrl && typeof window !== "undefined") setOrigin(window.location.origin);
  }, [appUrl]);

  const url = token ? `${origin}/clubs/join/${token}` : null;

  const generate = () =>
    start(async () => {
      const res = await generateSeriesJoinTokenAction(seriesId);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setToken(res.token);
      router.refresh();
    });

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant={triggerVariant} className="gap-1.5" />}>
        <UserPlus className="h-4 w-4" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        {!url ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t("generateHint")}</p>
            <Button onClick={generate} disabled={pending} className="w-full">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("generate")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <div className="flex gap-2">
              <Input value={url} readOnly className="h-9 flex-1 font-mono text-xs" />
              <Button size="sm" variant="outline" className="h-9 shrink-0" aria-label={t("copy")} onClick={copy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <a
              href={`https://line.me/R/share?text=${encodeURIComponent(t("shareText") + "\n" + url)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button className="w-full gap-1.5">
                <Share2 className="h-4 w-4" />
                {t("shareLine")}
              </Button>
            </a>
            <div className="flex flex-col items-center gap-2">
              <div className="rounded-md bg-white p-3">
                <QRCode value={url} size={148} />
              </div>
              <p className="text-xs text-muted-foreground">{t("qrHint")}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("bindHint")}{" "}
              <Link href={`/clubs/${seriesId}?tab=settings`} className="underline hover:text-foreground">
                {t("bindLink")}
              </Link>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
