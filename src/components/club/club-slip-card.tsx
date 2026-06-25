"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { toast } from "sonner";
import { domToBlob } from "modern-screenshot";
import { ImageDown, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { buildPromptPayPayload } from "@/lib/club/promptpay";
import { parseReceiptTemplate, hasBankReceiver, resolveReceiptTheme } from "@/lib/club/receipt";
import QRCode from "qrcode";
import type { Club } from "@/lib/types";
import type { ClubCostRow } from "@/lib/club/cost-summary";

/**
 * Shared slip-card pieces — the styled per-player receipt card that gets captured
 * to a PNG and shared to LINE / downloaded. Extracted from the old standalone
 * `club-slip-share.tsx` so the unified ClubPaymentCollector can reuse them both
 * per-player (SlipDialog) and in a batch loop (SlipCard + renderSlipBlob).
 */

export const baht = (n: number) => `฿${n.toLocaleString()}`;

export function sanitizeFilename(s: string): string {
  return s.replace(/[^\w฀-๿-]/g, "_");
}

// The QR (react-qr-code) is a dynamic ssr:false import, so it mounts a frame or
// two AFTER the slip first paints. Capturing before its <svg> has content (or
// before the centre-logo / uploaded-QR <img> finishes loading) yields a blank QR
// in the PNG. Wait until the QR svg has drawn and every <img> is decoded.
async function waitForAssets(node: HTMLElement, timeoutMs = 2500): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const svg = node.querySelector("svg");
    const svgReady = !svg || !!svg.querySelector("path, rect, image");
    const imgsReady = Array.from(node.querySelectorAll("img")).every(
      (im) => im.complete && im.naturalWidth > 0,
    );
    if (svgReady && imgsReady) return;
    await new Promise((r) => setTimeout(r, 60));
  }
}

export async function renderSlipBlob(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready; // ensure Anuphan/Chakra are loaded
  await waitForAssets(node); // ensure the dynamic QR svg + images have rendered
  await domToBlob(node, { scale: 3, backgroundColor: "#ffffff" }); // warm-up (fonts/SVG)
  return domToBlob(node, { scale: 3, backgroundColor: "#ffffff" });
}

export async function shareOrDownload(
  blob: Blob,
  filename: string,
  shareText: string,
  title: string,
  forceDownload = false,
) {
  const file = new File([blob], filename, { type: "image/png" });
  if (
    !forceDownload &&
    typeof navigator !== "undefined" &&
    navigator.canShare?.({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title, text: shareText });
      return;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// QR rendered as a raster <img> (PNG data URL) instead of inline <svg>. modern-
// screenshot's foreignObject capture renders react-qr-code's inline <svg> BLANK,
// but a raster <img> serializes cleanly. Same payload + EC level H, so the QR
// matrix (and scannability) is identical to the on-screen GeneratedQr.
function SlipQr({ value, size, logoUrl }: { value: string; size: number; logoUrl: string | null }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { errorCorrectionLevel: "H", margin: 1, width: size * 3 })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, size]);

  const logo = Math.round(size * 0.26);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {dataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt=""
          width={size}
          height={size}
          style={{ display: "block", width: size, height: size }}
        />
      )}
      {dataUrl && logoUrl && (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            width: logo,
            height: logo,
            display: "grid",
            placeItems: "center",
            background: "#ffffff",
            borderRadius: 6,
            padding: Math.round(logo * 0.1),
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * Filename + share text + dialog title for a player's slip — single-sourced so the
 * per-player dialog and the batch download loop can't diverge. `t` = a `club.slip`
 * translator (from `useTranslations("club.slip")`).
 */
export function buildSlipMeta(
  t: (key: string, values?: Record<string, string | number>) => string,
  club: Club,
  playerName: string,
  total: number,
): { filename: string; shareText: string; title: string } {
  return {
    filename: `slip-${sanitizeFilename(club.name)}-${sanitizeFilename(playerName)}.png`,
    shareText: t("shareText", { club: club.name, amount: total.toLocaleString() }),
    title: t("dialogTitle", { name: playerName }),
  };
}

export type SlipCardProps = {
  club: Club;
  row: ClubCostRow;
  playerName: string;
  ppNumber: boolean;
  qrImage: string | null;
  qrLogoUrl: string | null;
  locale: string;
};

export const SlipCard = forwardRef<HTMLDivElement, SlipCardProps>(function SlipCard(
  { club, row, playerName, ppNumber, qrImage, qrLogoUrl, locale },
  ref,
) {
  const t = useTranslations("club.slip");
  const tp = useTranslations("club.payment");

  // Format date safely — raw string fallback if parsing fails
  let dateStr = club.play_date;
  try {
    dateStr = format(new Date(club.play_date), "dd MMM yyyy", {
      locale: dateFnsLocaleOf(locale),
    });
  } catch {
    // keep raw string
  }

  // Receipt customization rides along on the `club` object (parsed here so every call
  // site — dialog, batch loop, editor preview — gets the same derivation).
  const tpl = parseReceiptTemplate(club.receipt_template);
  const theme = resolveReceiptTheme(tpl.theme);
  const showPromptpay = tpl.payment_show.promptpay;
  const qrValue =
    showPromptpay && ppNumber && club.promptpay_id
      ? buildPromptPayPayload(club.promptpay_id, row.total)
      : "";
  const ppImage = showPromptpay && !qrValue && qrImage ? qrImage : null;
  const showBank = tpl.payment_show.bank && hasBankReceiver(tpl.bank);
  const anyPayment = !!qrValue || !!ppImage || showBank;

  return (
    <div
      ref={ref}
      style={{
        width: 360,
        fontFamily: "Anuphan, sans-serif",
        backgroundColor: "#ffffff",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
      }}
    >
      {/* Header band */}
      <div
        style={{
          backgroundColor: theme.headerBg,
          padding: "16px 20px 14px",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "Chakra Petch, Anuphan, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 0.2,
          }}
        >
          {club.receipt_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={club.receipt_logo_url}
              alt=""
              width={26}
              height={26}
              style={{
                width: 26,
                height: 26,
                objectFit: "contain",
                borderRadius: 6,
                background: "#ffffff",
                flexShrink: 0,
              }}
            />
          ) : (
            <span>🏸</span>
          )}
          <span>{club.name}</span>
        </div>
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.85 }}>
          {dateStr}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "16px 20px 8px", backgroundColor: "#ffffff" }}>
        {/* Player name */}
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "#111827",
            marginBottom: 12,
          }}
        >
          {playerName}
        </div>

        {/* Itemized rows */}
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          {/* Court — hide when owner toggled it off */}
          {tpl.fields.court && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
              }}
            >
              <span>{tp("colCourt")}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {baht(row.court)}
              </span>
            </div>
          )}

          {/* Shuttle — hide when owner toggled it off */}
          {tpl.fields.shuttle && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
              }}
            >
              <span>
                {tp("colShuttle")} ({tp("gamesSuffix", { n: row.games })})
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {baht(row.shuttle)}
              </span>
            </div>
          )}

          {/* Expense — hide if zero or toggled off */}
          {tpl.fields.expense && row.expense > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
              }}
            >
              <span>{tp("colExpense")}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {baht(row.expense)}
              </span>
            </div>
          )}

          {/* Discount — show only if >0 and not toggled off */}
          {tpl.fields.discount && row.discount > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
              }}
            >
              <span>{tp("colDiscount")}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                -{baht(row.discount)}
              </span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div
          style={{
            borderTop: "1px solid #e5e7eb",
            margin: "10px 0 8px",
          }}
        />

        {/* Total */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
            {tp("colTotal")}
          </span>
          <span
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: theme.totalColor,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {baht(row.total)}
          </span>
        </div>
      </div>

      {/* QR block */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "12px 20px 16px",
          backgroundColor: "#ffffff",
        }}
      >
        <div
          style={{
            backgroundColor: "#f9fafb",
            borderRadius: 12,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          {qrValue ? (
            <SlipQr value={qrValue} size={220} logoUrl={qrLogoUrl} />
          ) : ppImage ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ppImage}
                alt=""
                width={220}
                height={220}
                style={{ objectFit: "contain" }}
              />
              <span
                style={{ fontSize: 11, color: "#6b7280", textAlign: "center" }}
              >
                {t("qrImageHint", { amount: row.total.toLocaleString() })}
              </span>
            </>
          ) : null}

          {/* Bank-account receiver (#12a) — plain text */}
          {showBank && (
            <div
              style={{
                textAlign: "center",
                fontSize: 13,
                color: "#374151",
                lineHeight: 1.5,
                padding: qrValue || ppImage ? "8px 4px 0" : "4px",
              }}
            >
              <div style={{ fontWeight: 700, color: "#111827" }}>
                {tp("bankTransfer")}
              </div>
              <div style={{ fontVariantNumeric: "tabular-nums" }}>
                {tpl.bank.name} · {tpl.bank.account_no}
              </div>
              <div style={{ color: "#6b7280", fontSize: 12 }}>
                {tpl.bank.account_name}
              </div>
            </div>
          )}

          {!anyPayment && (
            <div
              style={{
                width: 220,
                height: 80,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: "#9ca3af",
                textAlign: "center",
              }}
            >
              {t("noPromptpay")}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {((showPromptpay && (club.promptpay_name || club.promptpay_id)) || tpl.footer_note) && (
        <div
          style={{
            padding: "0 20px 16px",
            fontSize: 11,
            color: "#9ca3af",
            textAlign: "center",
            backgroundColor: "#ffffff",
          }}
        >
          {showPromptpay && (club.promptpay_name || club.promptpay_id) && (
            <div>
              {t("footerNote", {
                name: club.promptpay_name || club.promptpay_id || "",
              })}
            </div>
          )}
          {tpl.footer_note && (
            <div style={{ marginTop: 3, color: "#6b7280", whiteSpace: "pre-wrap" }}>
              {tpl.footer_note}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function SlipDialog({
  open,
  onOpenChange,
  club,
  row,
  playerName,
  ppNumber,
  qrImage,
  qrLogoUrl,
  locale,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  club: Club;
  row: SlipCardProps["row"];
  playerName: string;
  ppNumber: boolean;
  qrImage: string | null;
  qrLogoUrl: string | null;
  locale: string;
}) {
  const t = useTranslations("club.slip");
  const cardRef = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);

  const { filename, shareText, title } = buildSlipMeta(t, club, playerName, row.total);

  // While no blob is ready the buttons show a generating state and stay disabled.
  const busy = !blob;

  // Pre-render the slip to a PNG blob as soon as the dialog opens, so the Share
  // click can reach navigator.share() synchronously. iOS Safari drops the
  // transient user activation when share() is called after a long await, which
  // would make share-to-LINE silently fall back to a download.
  useEffect(() => {
    if (!open) {
      setBlob(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        if (cancelled || !cardRef.current) return;
        const b = await renderSlipBlob(cardRef.current);
        if (!cancelled) setBlob(b);
      } catch {
        if (!cancelled) toast.error(t("shareError"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleShare() {
    if (!blob) return;
    await shareOrDownload(blob, filename, shareText, title, false);
  }

  async function handleDownload() {
    if (!blob) return;
    await shareOrDownload(blob, filename, shareText, title, true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Preview — centred, horizontally scrollable on very small screens */}
        <div className="flex justify-center overflow-x-auto py-2">
          <SlipCard
            ref={cardRef}
            club={club}
            row={row}
            playerName={playerName}
            ppNumber={ppNumber}
            qrImage={qrImage}
            qrLogoUrl={qrLogoUrl}
            locale={locale}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={handleDownload}
                  className="gap-1.5"
                />
              }
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImageDown className="h-4 w-4" />
              )}
              {busy ? t("generating") : t("downloadButton")}
            </TooltipTrigger>
            <TooltipContent>{t("downloadButton")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={handleShare}
                  className="gap-1.5"
                />
              }
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {busy ? t("generating") : t("shareButton")}
            </TooltipTrigger>
            <TooltipContent>{t("shareButton")}</TooltipContent>
          </Tooltip>
        </div>
      </DialogContent>
    </Dialog>
  );
}
