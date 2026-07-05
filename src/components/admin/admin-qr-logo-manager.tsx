"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImageUp, Loader2, QrCode, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  setQrLogoEnabledAction,
  uploadQrLogoAction,
  removeQrLogoAction,
} from "@/lib/actions/app-settings";

export function AdminQrLogoManager({
  initialEnabled,
  initialCustomUrl,
  defaultLogo,
}: {
  initialEnabled: boolean;
  initialCustomUrl: string | null;
  defaultLogo: string;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [customUrl, setCustomUrl] = useState(initialCustomUrl);
  const [savingToggle, startToggle] = useTransition();
  const [busyImg, startImg] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const shownLogo = customUrl || defaultLogo;

  function toggle(next: boolean) {
    if (next === enabled) return;
    setEnabled(next); // optimistic
    startToggle(async () => {
      const res = await setQrLogoEnabledAction(next);
      if (res && "error" in res) {
        toast.error(res.error);
        setEnabled(!next);
      } else {
        toast.success(t("saved"));
        router.refresh();
      }
    });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type) || file.size > 1_000_000) {
      toast.error(t("uploadInvalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      startImg(async () => {
        const res = await uploadQrLogoAction({ dataUrl });
        if (res && "error" in res) toast.error(res.error);
        else {
          setCustomUrl(res.url);
          toast.success(t("saved"));
          router.refresh();
        }
      });
    };
    reader.readAsDataURL(file);
  }

  function reset() {
    startImg(async () => {
      const res = await removeQrLogoAction();
      if (res && "error" in res) toast.error(res.error);
      else {
        setCustomUrl(null);
        toast.success(t("saved"));
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="h-4 w-4" />
          {t("qrLogoTitle")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("qrLogoDesc")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* on/off toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t("enabledLabel")}</span>
          <div className="ml-auto flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={enabled ? "default" : "outline"}
              className="h-7 px-3 text-xs"
              disabled={savingToggle}
              onClick={() => toggle(true)}
            >
              {t("on")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={!enabled ? "default" : "outline"}
              className="h-7 px-3 text-xs"
              disabled={savingToggle}
              onClick={() => toggle(false)}
            >
              {t("off")}
            </Button>
          </div>
        </div>

        {enabled ? (
          <div className="flex items-center gap-3 rounded-xl border p-3">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border bg-white p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shownLogo} alt="" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {customUrl ? t("usingCustom") : t("usingDefault")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  disabled={busyImg}
                  onClick={() => fileRef.current?.click()}
                >
                  {busyImg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />}
                  {busyImg ? t("uploading") : t("uploadBtn")}
                </Button>
                {customUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    disabled={busyImg}
                    onClick={reset}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("useDefault")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            {t("disabledHint")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
