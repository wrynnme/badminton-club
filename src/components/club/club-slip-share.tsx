"use client";

import { forwardRef, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { format } from "date-fns";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { toast } from "sonner";
import { domToBlob } from "modern-screenshot";
import { Download, ImageDown, Loader2, QrCode, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { computeClubCostRows } from "@/lib/club/cost-summary";
import { buildPromptPayPayload, isValidPromptPayId } from "@/lib/club/promptpay";
import QRCode from "qrcode";
import type { Club, ClubMatch, ClubPlayer } from "@/lib/types";
import type { ClubExpense } from "@/lib/actions/club-cost";

// ─── helpers ───────────────────────────────────────────────────────────────────

const baht = (n: number) => `฿${n.toLocaleString()}`;

function sanitizeFilename(s: string): string {
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

async function renderSlipBlob(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready; // ensure Anuphan/Chakra are loaded
  await waitForAssets(node); // ensure the dynamic QR svg + images have rendered
  await domToBlob(node, { scale: 3, backgroundColor: "#ffffff" }); // warm-up (fonts/SVG)
  return domToBlob(node, { scale: 3, backgroundColor: "#ffffff" });
}

async function shareOrDownload(
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

// ─── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  club: Club;
  players: ClubPlayer[];
  matches: ClubMatch[];
  expenses: ClubExpense[];
  qrLogoUrl: string | null;
};

// ─── SlipCard (capture target) ─────────────────────────────────────────────────

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

type SlipCardProps = {
  club: Club;
  row: {
    playerId: string;
    court: number;
    shuttle: number;
    expense: number;
    discount: number;
    total: number;
    games: number;
  };
  playerName: string;
  ppNumber: boolean;
  qrImage: string | null;
  qrLogoUrl: string | null;
  locale: string;
};

const SlipCard = forwardRef<HTMLDivElement, SlipCardProps>(function SlipCard(
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

  const qrValue =
    ppNumber && club.promptpay_id
      ? buildPromptPayPayload(club.promptpay_id, row.total)
      : "";

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
          backgroundColor: "#2e7d4f",
          padding: "16px 20px 14px",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            fontFamily: "Chakra Petch, Anuphan, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 0.2,
          }}
        >
          🏸 {club.name}
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
          {/* Court */}
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

          {/* Shuttle */}
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

          {/* Expense — hide if zero */}
          {row.expense > 0 && (
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

          {/* Discount — show only if >0 */}
          {row.discount > 0 && (
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
              color: "#2e7d4f",
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
          ) : qrImage ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrImage}
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
          ) : (
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
      {(club.promptpay_name || club.promptpay_id) && (
        <div
          style={{
            padding: "0 20px 16px",
            fontSize: 11,
            color: "#9ca3af",
            textAlign: "center",
            backgroundColor: "#ffffff",
          }}
        >
          {t("footerNote", {
            name: club.promptpay_name || club.promptpay_id || "",
          })}
        </div>
      )}
    </div>
  );
});

// ─── SlipDialog ────────────────────────────────────────────────────────────────

function SlipDialog({
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

  const filename = `slip-${sanitizeFilename(club.name)}-${sanitizeFilename(playerName)}.png`;
  const shareText = t("shareText", {
    club: club.name,
    amount: row.total.toLocaleString(),
  });
  const title = t("dialogTitle", { name: playerName });

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

// ─── Main export ───────────────────────────────────────────────────────────────

export function ClubSlipShare({
  club,
  players,
  matches,
  expenses,
  qrLogoUrl,
}: Props) {
  const t = useTranslations("club.slip");
  const locale = useLocale();

  const { rows } = computeClubCostRows({ club, players, matches, expenses });
  const nameById = new Map(players.map((p) => [p.id, p.display_name]));
  const paidById = new Map(players.map((p) => [p.id, !!p.paid_at]));
  const payable = rows.filter((r) => r.total > 0);

  const ppNumber = !!club.promptpay_id && isValidPromptPayId(club.promptpay_id);
  const qrImage = club.promptpay_qr_image || null;
  const ppConfigured = ppNumber || !!qrImage;

  // Default selection: unpaid payable players
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        payable
          .filter((r) => !paidById.get(r.playerId))
          .map((r) => r.playerId),
      ),
  );

  // Per-player dialog open state
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);

  // Batch download state
  const [batchPending, startBatch] = useTransition();
  const [batchGenerating, setBatchGenerating] = useState(false);
  const batchBusy = batchPending || batchGenerating;

  // Hidden container for off-screen batch renders
  const batchContainerRef = useRef<HTMLDivElement>(null);
  const [batchPlayer, setBatchPlayer] = useState<string | null>(null);

  // Warm the react-qr-code chunk so the first off-screen batch capture (and the
  // first dialog open) isn't raced by its lazy ssr:false import.
  useEffect(() => {
    void import("react-qr-code");
  }, []);

  if (payable.length === 0) {
    return null;
  }

  const allSelected = payable.every((r) => selected.has(r.playerId));
  const selectedCount = payable.filter((r) => selected.has(r.playerId)).length;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(payable.map((r) => r.playerId)));
    }
  }

  function toggleOne(playerId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  async function downloadBatch() {
    const selectedRows = payable.filter((r) => selected.has(r.playerId));
    if (selectedRows.length === 0) return;
    setBatchGenerating(true);

    startBatch(async () => {
      for (const row of selectedRows) {
        const playerName = nameById.get(row.playerId) ?? row.playerId;
        // Render the hidden slip card for this player
        setBatchPlayer(row.playerId);
        // Allow React to commit the new batchPlayer state before capturing
        await new Promise<void>((resolve) => setTimeout(resolve, 120));
        const node = batchContainerRef.current?.firstElementChild as HTMLElement | null;
        if (!node) continue;
        try {
          const blob = await renderSlipBlob(node);
          const filename = `slip-${sanitizeFilename(club.name)}-${sanitizeFilename(playerName)}.png`;
          const shareText = t("shareText", {
            club: club.name,
            amount: row.total.toLocaleString(),
          });
          const title = t("dialogTitle", { name: playerName });
          await shareOrDownload(blob, filename, shareText, title, true);
        } catch {
          toast.error(t("shareError"));
        }
      }
      setBatchPlayer(null);
      setBatchGenerating(false);
    });
  }

  const currentBatchRow = batchPlayer
    ? payable.find((r) => r.playerId === batchPlayer)
    : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-4 w-4 shrink-0" />
            {t("sectionTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("sectionHint")}</p>

          {/* Select all row */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="slip-select-all"
              checked={allSelected}
              onCheckedChange={toggleAll}
            />
            <label
              htmlFor="slip-select-all"
              className="text-sm cursor-pointer select-none"
            >
              {t("selectAll")}
            </label>
            <span className="ml-auto text-xs text-muted-foreground">
              {t("selectedCount", { n: selectedCount })}
            </span>
          </div>

          {/* Player rows */}
          <div className="space-y-1.5">
            {payable.map((row) => {
              const playerName = nameById.get(row.playerId) ?? row.playerId;
              const isSelected = selected.has(row.playerId);
              const rowId = `slip-player-${row.playerId}`;

              return (
                <div
                  key={row.playerId}
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
                >
                  <Checkbox
                    id={rowId}
                    checked={isSelected}
                    onCheckedChange={() => toggleOne(row.playerId)}
                  />
                  <label
                    htmlFor={rowId}
                    className="flex-1 min-w-0 truncate text-sm cursor-pointer select-none"
                  >
                    {playerName}
                  </label>
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {baht(row.total)}
                  </span>

                  {/* Per-row send slip button */}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!ppConfigured}
                          onClick={() => setDialogOpen(row.playerId)}
                          className="h-7 gap-1 text-xs shrink-0"
                        />
                      }
                    >
                      <Send className="h-3.5 w-3.5" />
                      {t("sendSlip")}
                    </TooltipTrigger>
                    <TooltipContent>
                      {ppConfigured
                        ? t("shareButton")
                        : t("noPromptpay")}
                    </TooltipContent>
                  </Tooltip>

                  {/* Dialog for this player */}
                  <SlipDialog
                    open={dialogOpen === row.playerId}
                    onOpenChange={(o) => setDialogOpen(o ? row.playerId : null)}
                    club={club}
                    row={row}
                    playerName={playerName}
                    ppNumber={ppNumber}
                    qrImage={ppNumber ? null : qrImage}
                    qrLogoUrl={qrLogoUrl}
                    locale={locale}
                  />
                </div>
              );
            })}
          </div>

          {/* Batch download footer */}
          <div className="pt-1 flex justify-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={batchBusy || selectedCount === 0 || !ppConfigured}
                    onClick={downloadBatch}
                    className="gap-1.5 text-sm"
                  />
                }
              >
                {batchBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {batchBusy ? t("generating") : t("downloadAllButton")}
              </TooltipTrigger>
              <TooltipContent>
                {ppConfigured
                  ? t("downloadAllButton")
                  : t("noPromptpay")}
              </TooltipContent>
            </Tooltip>
          </div>
        </CardContent>
      </Card>

      {/* Off-screen batch capture container */}
      {batchPlayer && currentBatchRow && (
        <div
          ref={batchContainerRef}
          aria-hidden="true"
          style={{
            position: "fixed",
            top: -9999,
            left: -9999,
            pointerEvents: "none",
            zIndex: -1,
          }}
        >
          <SlipCard
            key={batchPlayer}
            club={club}
            row={currentBatchRow}
            playerName={nameById.get(batchPlayer) ?? batchPlayer}
            ppNumber={ppNumber}
            qrImage={ppNumber ? null : qrImage}
            qrLogoUrl={qrLogoUrl}
            locale={locale}
          />
        </div>
      )}
    </>
  );
}
