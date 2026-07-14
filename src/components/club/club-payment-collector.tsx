"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "@bprogress/next/app";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ChevronDown,
  Check,
  Download,
  ImageUp,
  Loader2,
  Maximize2,
  QrCode,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { parseReceiptTemplate, hasBankReceiver, resolveReceiptTheme, type ReceiptTemplate } from "@/lib/club/receipt";
import { ReceiptTemplateEditor } from "@/components/club/receipt-template-editor";
import {
  updateClubPaymentConfigAction,
  toggleClubPlayerPaidAction,
  resetAllPaidAction,
  uploadClubPromptPayQrAction,
  removeClubPromptPayQrAction,
  uploadBillSlipAction,
} from "@/lib/actions/club-payments";
import { pushClubBillsAction } from "@/lib/actions/club-billing";
import type { Club, ClubMatch, ClubPlayer } from "@/lib/types";
import type { ClubExpense } from "@/lib/actions/club-cost";
import { GeneratedQr } from "@/components/club/generated-qr";
import { GroupBillDialog } from "@/components/club/group-bill-dialog";
import {
  baht,
  buildSlipMeta,
  SlipCard,
  SlipDialog,
  renderSlipBlob,
  shareOrDownload,
} from "@/components/club/club-slip-card";
import type { ClubCostRow } from "@/lib/club/cost-summary";

type Props = {
  clubId: string;
  club: Club;
  players: ClubPlayer[];
  matches: ClubMatch[];
  expenses: ClubExpense[];
  /** Site-wide centre-of-QR logo URL (/admin setting); null = logo turned off. */
  qrLogoUrl: string | null;
  /** club_players.id values whose linked profile has a non-null line_user_id. */
  lineReachableIds: string[];
  /** true when clubs.line_group_id is bound — gates the group-billing button. */
  lineGroupBound: boolean;
};

/** Reads a rendered slip PNG Blob back out as a base64 data URL for upload. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Off-screen SlipCard mount request — shared shape for the 1:1 and group push loops. */
type PushSlipItem = {
  key: string;
  row: ClubCostRow;
  playerName: string;
};

export function ClubPaymentCollector({ clubId, club, players, matches, expenses, qrLogoUrl, lineReachableIds, lineGroupBound }: Props) {
  const t = useTranslations("club.payment");
  const tSlip = useTranslations("club.slip");
  const locale = useLocale();
  const router = useRouter();
  const [pushing, startPush] = useTransition();
  const [groupDlgOpen, setGroupDlgOpen] = useState(false);

  // Warm the react-qr-code chunk so the first off-screen batch capture (and the
  // first per-player slip dialog) isn't raced by its lazy ssr:false import.
  useEffect(() => {
    void import("react-qr-code");
  }, []);

  const reachable = new Set(lineReachableIds);
  const billPushedAtById = new Map(players.map((p) => [p.id, p.bill_pushed_at]));

  // Per-player rows from the SAME builder the breakdown table uses → totals match.
  const { rows } = computeClubCostRows({ club, players, matches, expenses });
  const nameById = new Map(players.map((p) => [p.id, p.display_name]));
  const payable = rows.filter((r) => r.total > 0);

  // Optimistic paid state, seeded from DB props. Resync when the server set changes
  // (e.g. realtime/refresh from another device) — keyed on a stable signature so a
  // toggle's own optimistic update isn't clobbered before its action lands.
  const serverPaid = players.filter((p) => p.paid_at).map((p) => p.id);
  const serverPaidKey = [...serverPaid].sort().join(",");
  const [paidIds, setPaidIds] = useState<Set<string>>(() => new Set(serverPaid));
  useEffect(() => {
    setPaidIds(new Set(serverPaidKey ? serverPaidKey.split(",") : []));
  }, [serverPaidKey]);

  const collected = payable.filter((r) => paidIds.has(r.playerId)).reduce((s, r) => s + r.total, 0);
  const grandTotal = payable.reduce((s, r) => s + r.total, 0);
  const paidCount = payable.filter((r) => paidIds.has(r.playerId)).length;
  const remainCount = payable.length - paidCount;
  const remainAmount = grandTotal - collected;
  const pct = grandTotal > 0 ? Math.round((collected / grandTotal) * 100) : 0;

  // A valid number generates an amount-embedded QR (preferred); otherwise fall back
  // to an owner-uploaded QR image (no amount embedded). configured = either is set.
  const ppNumber = !!club.promptpay_id && isValidPromptPayId(club.promptpay_id);
  const qrImage = club.promptpay_qr_image || null;
  const ppConfigured = ppNumber || !!qrImage;
  // A slip can be produced when any payment channel the receipt shows is configured
  // (so bank-only clubs can still batch-download slips, not just PromptPay ones).
  const receiptTpl = parseReceiptTemplate(club.receipt_template);
  const slipConfigured =
    (receiptTpl.payment_show.promptpay && ppConfigured) ||
    (receiptTpl.payment_show.bank && hasBankReceiver(receiptTpl.bank));

  // Batch slip download — render every payable player's slip card off-screen → PNG,
  // one at a time (the QR/font capture needs the node mounted before domToBlob).
  const [batchPending, startBatch] = useTransition();
  const [batchGenerating, setBatchGenerating] = useState(false);
  const batchBusy = batchPending || batchGenerating;
  const batchContainerRef = useRef<HTMLDivElement>(null);
  const [batchRow, setBatchRow] = useState<ClubCostRow | null>(null);

  function downloadAllSlips() {
    if (payable.length === 0) return;
    setBatchGenerating(true);
    startBatch(async () => {
      for (const row of payable) {
        const playerName = nameById.get(row.playerId) ?? row.playerId;
        setBatchRow(row); // mount the off-screen SlipCard for this player
        // Let React commit the new batch row before capturing the node.
        await new Promise<void>((resolve) => setTimeout(resolve, 120));
        const node = batchContainerRef.current?.firstElementChild as HTMLElement | null;
        if (!node) continue;
        try {
          const blob = await renderSlipBlob(node);
          const { filename, shareText, title } = buildSlipMeta(tSlip, club, playerName, row.total);
          await shareOrDownload(blob, filename, shareText, title, true);
        } catch {
          toast.error(tSlip("shareError"));
        }
      }
      setBatchRow(null);
      setBatchGenerating(false);
    });
  }

  // Push slips (1:1): render → upload → push. Off-screen mount for the batch loop.
  const pushSlipContainerRef = useRef<HTMLDivElement>(null);
  const [pushSlipItem, setPushSlipItem] = useState<PushSlipItem | null>(null);
  const [pushProgress, setPushProgress] = useState<{ done: number; total: number } | null>(null);

  /** Mounts `item` off-screen, waits for the commit + QR/font render, captures it
   *  to a PNG, and returns a base64 data URL — or null if the node/capture fails. */
  async function renderOffscreenSlipDataUrl(
    containerRef: React.RefObject<HTMLDivElement | null>,
    setItem: (item: PushSlipItem | null) => void,
    item: PushSlipItem,
  ): Promise<string | null> {
    // Force-commit the off-screen mount synchronously. These functions run inside a
    // useTransition callback, so a plain setState is a low-priority update whose DOM
    // commit can be deferred past our read below — yielding a null node → the slip
    // "fails to render". flushSync guarantees the node exists before we capture it.
    flushSync(() => setItem(item));
    // Give the SlipCard's async QR (qrcode.toDataURL in a useEffect) a frame to draw.
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    const node = containerRef.current?.firstElementChild as HTMLElement | null;
    if (!node) {
      console.error("[bill-slip] off-screen node missing after flushSync", item.key);
      return null;
    }
    try {
      const blob = await renderSlipBlob(node);
      return await blobToDataUrl(blob);
    } catch (e) {
      console.error("[bill-slip] renderSlipBlob threw for", item.key, e);
      return null;
    }
  }

  /** Render + upload one slip per item (off-screen), returning the URLs keyed by
   *  item.key. Per-item failures are skipped (not fatal); `failKind` reports the
   *  first failure so the caller can surface a localized note. Shared by both the
   *  1:1 and group push flows (they differ only in the item list + upload kind). */
  async function renderUploadSlips(
    items: PushSlipItem[],
    kind: "player" | "amount",
    containerRef: React.RefObject<HTMLDivElement | null>,
    setItem: (item: PushSlipItem | null) => void,
    setProgress: (p: { done: number; total: number } | null) => void,
  ): Promise<{ urlByKey: Record<string, string>; failKind: "render" | "upload" | null }> {
    setProgress(items.length > 0 ? { done: 0, total: items.length } : null);
    const urlByKey: Record<string, string> = {};
    let failKind: "render" | "upload" | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const dataUrl = await renderOffscreenSlipDataUrl(containerRef, setItem, item);
      if (!dataUrl) {
        failKind = failKind ?? "render";
      } else {
        const up = await uploadBillSlipAction({ clubId, kind, key: item.key, dataUrl });
        if (up && "url" in up) {
          urlByKey[item.key] = up.url;
        } else {
          failKind = failKind ?? "upload";
          console.error("[bill-slip] upload failed for", kind, item.key, up);
        }
      }
      setProgress({ done: i + 1, total: items.length });
    }
    setItem(null);
    setProgress(null);
    return { urlByKey, failKind };
  }

  /** Localized parenthesized note for a slip failure kind, or "" when none (i18n —
   *  never surface raw error strings). */
  const slipFailNote = (kind: "render" | "upload" | null) =>
    kind ? ` (${kind === "render" ? t("slipRenderFailed") : t("slipUploadFailed")})` : "";

  function pushBillsWithSlips() {
    // Mirror who the server would actually push to — rendering for players with
    // no linked LINE account is wasted work.
    const items: PushSlipItem[] = payable
      .filter((r) => reachable.has(r.playerId))
      .map((row) => ({
        key: row.playerId,
        row,
        playerName: nameById.get(row.playerId) ?? row.playerId,
      }));
    startPush(async () => {
      const { urlByKey, failKind } = await renderUploadSlips(
        items,
        "player",
        pushSlipContainerRef,
        setPushSlipItem,
        setPushProgress,
      );
      const res = await pushClubBillsAction({ clubId, slipUrlByPlayerId: urlByKey });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const base = t("pushResult", { pushed: res.pushed, noLine: res.skippedNoLine, failed: res.failed });
      const note =
        res.skippedNoSlip > 0
          ? ` · ${t("pushNoSlipNote", { n: res.skippedNoSlip })}${slipFailNote(failKind)}`
          : "";
      if (res.pushed === 0 && res.skippedNoSlip > 0) toast.error(base + note);
      else toast.success(base + note);
    });
  }

  // Unpaid roster fed to the group-bill preview dialog — mirrors who the server
  // would actually resolve (payable + unpaid), tagged with LINE reachability.
  const unpaidForGroupBill = payable
    .filter((r) => !paidIds.has(r.playerId))
    .map((r) => ({
      playerId: r.playerId,
      displayName: nameById.get(r.playerId) ?? "",
      amount: r.total,
      hasLine: reachable.has(r.playerId),
    }));

  return (
    <>
    <Card>
      <CardContent className="space-y-4 pt-4">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          {t("collectTitle")}
        </h2>

        <PromptPayConfig
          clubId={clubId}
          initialId={club.promptpay_id ?? ""}
          initialName={club.promptpay_name ?? ""}
          initialQrImage={qrImage ?? ""}
          configured={ppConfigured}
        />

        <ReceiptTemplateEditor
          clubId={clubId}
          club={club}
          ppNumber={ppNumber}
          qrImage={ppNumber ? null : qrImage}
          qrLogoUrl={qrLogoUrl}
          locale={locale}
        />

        {payable.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("nothingToCollect")}</p>
        ) : (
          <>
            {/* summary + progress */}
            <div className="rounded-xl border bg-card p-3.5 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">{t("summaryCollected")}</span>
                <span className="text-sm font-semibold">{t("summaryCount", { paid: paidCount, total: payable.length })}</span>
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {baht(collected)} <span className="text-base font-medium text-muted-foreground">/ {baht(grandTotal)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className={`text-xs font-medium ${remainCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {remainCount > 0 ? t("remaining", { n: remainCount, amount: remainAmount.toLocaleString() }) : t("allCollected")}
                </span>
                {paidCount > 0 && <ResetPaidButton clubId={clubId} onReset={() => setPaidIds(new Set())} />}
              </div>
              <div className="pt-1 flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        disabled={pushing || payable.length === 0}
                        onClick={pushBillsWithSlips}
                      />
                    }
                  >
                    {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {pushing
                      ? pushProgress
                        ? t("generatingSlips", { done: pushProgress.done, total: pushProgress.total })
                        : t("pushing")
                      : t("pushLineBtn")}
                  </TooltipTrigger>
                  <TooltipContent>{t("pushLineTip")}</TooltipContent>
                </Tooltip>

                {/* Open the group-bill preview dialog: one consolidated numbered list +
                    amount-less QR posted into the club's bound LINE group */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        disabled={unpaidForGroupBill.length === 0 || !lineGroupBound}
                        onClick={() => setGroupDlgOpen(true)}
                      />
                    }
                  >
                    <Users className="h-3.5 w-3.5" />
                    {t("pushGroupBtn")}
                  </TooltipTrigger>
                  <TooltipContent>{lineGroupBound ? t("pushGroupTip") : t("pushGroupDisabledTip")}</TooltipContent>
                </Tooltip>

                {/* Batch: download every payable player's slip image (for non-LINE players) */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        disabled={batchBusy || payable.length === 0 || !slipConfigured}
                        onClick={downloadAllSlips}
                      />
                    }
                  >
                    {batchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    {batchBusy ? tSlip("generating") : tSlip("downloadAllButton")}
                  </TooltipTrigger>
                  <TooltipContent>{slipConfigured ? tSlip("downloadAllButton") : tSlip("noPromptpay")}</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* per-player receipts */}
            <div className="space-y-2">
              {payable.map((row) => (
                <PlayerReceipt
                  key={row.playerId}
                  clubId={clubId}
                  club={club}
                  receiptTpl={receiptTpl}
                  row={row}
                  name={nameById.get(row.playerId) ?? row.playerId}
                  paid={paidIds.has(row.playerId)}
                  ppNumber={ppNumber}
                  promptpayId={ppNumber ? club.promptpay_id! : null}
                  qrImage={ppNumber ? null : qrImage}
                  qrLogoUrl={qrLogoUrl}
                  promptpayName={club.promptpay_name}
                  locale={locale}
                  lineReachable={reachable.has(row.playerId)}
                  billPushedAt={billPushedAtById.get(row.playerId) ?? null}
                  onToggle={(nowPaid) =>
                    setPaidIds((prev) => {
                      const next = new Set(prev);
                      if (nowPaid) next.add(row.playerId);
                      else next.delete(row.playerId);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>

    {/* Off-screen batch capture container — one slip card rendered at a time */}
    {batchRow && (
      <div
        ref={batchContainerRef}
        aria-hidden="true"
        style={{ position: "fixed", top: -9999, left: -9999, pointerEvents: "none", zIndex: -1 }}
      >
        <SlipCard
          key={batchRow.playerId}
          club={club}
          row={batchRow}
          playerName={nameById.get(batchRow.playerId) ?? batchRow.playerId}
          ppNumber={ppNumber}
          qrImage={ppNumber ? null : qrImage}
          qrLogoUrl={qrLogoUrl}
          locale={locale}
        />
      </div>
    )}

    {/* Off-screen push-slip capture container — 1:1 flow (variant="full") */}
    {pushSlipItem && (
      <div
        ref={pushSlipContainerRef}
        aria-hidden="true"
        style={{ position: "fixed", top: -9999, left: -9999, pointerEvents: "none", zIndex: -1 }}
      >
        <SlipCard
          key={pushSlipItem.key}
          club={club}
          row={pushSlipItem.row}
          playerName={pushSlipItem.playerName}
          ppNumber={ppNumber}
          qrImage={ppNumber ? null : qrImage}
          qrLogoUrl={qrLogoUrl}
          locale={locale}
          variant="full"
        />
      </div>
    )}

    <GroupBillDialog
      open={groupDlgOpen}
      onOpenChange={setGroupDlgOpen}
      clubId={clubId}
      club={club}
      unpaid={unpaidForGroupBill}
      onDone={() => {
        setGroupDlgOpen(false);
        router.refresh();
      }}
    />
    </>
  );
}

// ─── PromptPay receiver config (collapsible) ───────────────────────────────────

function PromptPayConfig({
  clubId,
  initialId,
  initialName,
  initialQrImage,
  configured,
}: {
  clubId: string;
  initialId: string;
  initialName: string;
  initialQrImage: string;
  configured: boolean;
}) {
  const t = useTranslations("club.payment");
  const router = useRouter();
  const [open, setOpen] = useState(!configured); // open by default until set up
  const [ppId, setPpId] = useState(initialId);
  const [ppName, setPpName] = useState(initialName);
  const [qrImage, setQrImage] = useState(initialQrImage);
  const [pending, start] = useTransition();
  const [uploading, startUpload] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size > 1_000_000) {
      toast.error(t("uploadInvalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      startUpload(async () => {
        const res = await uploadClubPromptPayQrAction({ clubId, dataUrl });
        if (res && "error" in res) toast.error(res.error);
        else {
          setQrImage(res.url);
          toast.success(t("saved"));
          router.refresh();
        }
      });
    };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    startUpload(async () => {
      const res = await removeClubPromptPayQrAction(clubId);
      if (res && "error" in res) toast.error(res.error);
      else {
        setQrImage("");
        router.refresh();
      }
    });
  }

  function save() {
    if (ppId.trim() && !isValidPromptPayId(ppId)) {
      toast.error(t("invalidId"));
      return;
    }
    start(async () => {
      const res = await updateClubPaymentConfigAction(clubId, {
        promptpay_id: ppId.trim() || null,
        promptpay_name: ppName.trim() || null,
      });
      if (res && "error" in res) toast.error(res.error);
      else {
        toast.success(t("saved"));
        router.refresh();
      }
    });
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border bg-muted/30">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium"
            />
          }
        >
          <QrCode className="h-4 w-4 shrink-0 text-primary" />
          {t("configTitle")}
          {!configured && <span className="text-xs font-normal text-amber-600">• {t("notSet")}</span>}
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2.5 px-3 pb-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("promptpayIdLabel")}</Label>
              <Input
                value={ppId}
                onChange={(e) => setPpId(e.target.value)}
                placeholder={t("promptpayIdPlaceholder")}
                className="h-8 text-sm"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("promptpayNameLabel")}</Label>
              <Input
                value={ppName}
                onChange={(e) => setPpName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={pending} onClick={save}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {t("save")}
            </Button>

            {/* OR upload a QR image (no amount embedded) */}
            <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t("orDivider")}
              <span className="h-px flex-1 bg-border" />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onPickFile}
            />
            {qrImage ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrImage} alt={t("uploadedQr")} className="h-20 w-20 rounded-lg border bg-white object-contain p-1" />
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{t("uploadedQr")}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs text-destructive"
                    disabled={uploading}
                    onClick={removeImage}
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {t("removeQr")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />}
                {uploading ? t("uploading") : t("uploadBtn")}
              </Button>
            )}
            {qrImage && isValidPromptPayId(ppId) && (
              <p className="text-[11px] text-muted-foreground">{t("numberPriorityNote")}</p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── Single player receipt (Variant C) ─────────────────────────────────────────

function PlayerReceipt({
  clubId,
  club,
  receiptTpl: tpl,
  row,
  name,
  paid,
  ppNumber,
  promptpayId,
  qrImage,
  qrLogoUrl,
  promptpayName,
  locale,
  lineReachable,
  billPushedAt,
  onToggle,
}: {
  clubId: string;
  club: Club;
  receiptTpl: ReceiptTemplate;
  row: ClubCostRow;
  name: string;
  paid: boolean;
  ppNumber: boolean;
  promptpayId: string | null;
  qrImage: string | null;
  qrLogoUrl: string | null;
  promptpayName: string | null;
  locale: string;
  lineReachable: boolean;
  billPushedAt: string | null;
  onToggle: (nowPaid: boolean) => void;
}) {
  const t = useTranslations("club.payment");
  const tSlip = useTranslations("club.slip");
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);
  const [pending, start] = useTransition();

  // Receipt customization (parsed once in the collector, passed down) gates the
  // breakdown rows + payment channels.
  const theme = resolveReceiptTheme(tpl.theme);
  const showPromptpay = tpl.payment_show.promptpay;
  const showBank = tpl.payment_show.bank && hasBankReceiver(tpl.bank);
  const payload = showPromptpay && promptpayId ? buildPromptPayPayload(promptpayId, row.total) : "";
  const ppImage = showPromptpay ? qrImage : null;
  const canSlip = !!payload || !!ppImage || showBank;

  function toggle() {
    const nowPaid = !paid;
    onToggle(nowPaid); // optimistic
    start(async () => {
      const res = await toggleClubPlayerPaidAction({ clubId, playerId: row.playerId });
      if (res && "error" in res) {
        toast.error(res.error);
        onToggle(!nowPaid); // revert
      }
    });
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${paid ? "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${paid ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
          {paid ? <Check className="h-4 w-4" /> : name.slice(0, 1)}
        </span>
        <span className="flex-1 min-w-0 truncate text-sm font-medium">{name}</span>
        {!lineReachable && (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground shrink-0">
            {t("noLine")}
          </Badge>
        )}
        {lineReachable && billPushedAt && !paid && (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 shrink-0">
            {t("billPushed")}
          </Badge>
        )}
        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${paid ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
          {paid ? t("paid") : t("unpaid")}
        </span>
        <span className="text-sm font-bold tabular-nums">{baht(row.total)}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-dashed px-3.5 pb-3.5 pt-1">
          {tpl.fields.court && (
            <div className="flex justify-between text-[13px] py-1 text-muted-foreground">
              <span>{t("colCourt")}</span><span className="tabular-nums">{baht(row.court)}</span>
            </div>
          )}
          {tpl.fields.shuttle && (
            <div className="flex justify-between text-[13px] py-1 text-muted-foreground">
              <span>{t("colShuttle")} ({t("gamesSuffix", { n: row.games })})</span><span className="tabular-nums">{baht(row.shuttle)}</span>
            </div>
          )}
          {tpl.fields.expense && (
            <div className="flex justify-between text-[13px] py-1 text-muted-foreground">
              <span>{t("colExpense")}</span><span className="tabular-nums">{baht(row.expense)}</span>
            </div>
          )}
          {tpl.fields.discount && row.discount > 0 && (
            <div className="flex justify-between text-[13px] py-1 text-muted-foreground">
              <span>{t("colDiscount")}</span><span className="tabular-nums">-{baht(row.discount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-2 mt-1 text-sm font-bold">
            <span>{t("colTotal")}</span><span className="tabular-nums" style={{ color: theme.totalColor }}>{baht(row.total)}</span>
          </div>

          <div className="flex gap-3 items-center mt-3">
            {payload ? (
              <button
                type="button"
                onClick={() => setZoom(true)}
                title={t("tapToZoom")}
                aria-label={t("tapToZoom")}
                className="relative shrink-0 cursor-zoom-in rounded-lg border bg-white p-2"
              >
                <GeneratedQr value={payload} size={96} logoUrl={qrLogoUrl} />
                <span className="absolute bottom-1 right-1 rounded-md bg-black/55 p-0.5 text-white">
                  <Maximize2 className="h-3 w-3" />
                </span>
              </button>
            ) : ppImage ? (
              <button
                type="button"
                onClick={() => setZoom(true)}
                title={t("tapToZoom")}
                aria-label={t("tapToZoom")}
                className="relative shrink-0 cursor-zoom-in rounded-lg border bg-white p-1"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ppImage} alt={t("uploadedQr")} className="h-[104px] w-[104px] object-contain" />
                <span className="absolute bottom-1 right-1 rounded-md bg-black/55 p-0.5 text-white">
                  <Maximize2 className="h-3 w-3" />
                </span>
              </button>
            ) : showBank ? (
              <div className="rounded-lg border bg-muted/40 p-2.5 shrink-0 grid place-items-center h-[112px] w-[112px] text-center text-[11px]">
                <div className="space-y-0.5">
                  <div className="font-semibold text-foreground">{t("bankTransfer")}</div>
                  <div className="tabular-nums">{tpl.bank.account_no}</div>
                  <div className="text-muted-foreground">{tpl.bank.name}</div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/40 p-2 shrink-0 grid place-items-center h-[112px] w-[112px] text-center text-[11px] text-muted-foreground">
                {t("noPromptpay")}
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2">
              {payload ? (
                <p className="text-xs text-muted-foreground">
                  {t("scanWith", { name: promptpayName || promptpayId || "" })}
                </p>
              ) : ppImage ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("qrImageHint", { amount: row.total.toLocaleString() })}
                </p>
              ) : showBank ? (
                <p className="text-xs text-muted-foreground">
                  {tpl.bank.account_name}
                </p>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="sm"
                      variant={paid ? "outline" : "default"}
                      disabled={pending}
                      onClick={toggle}
                      className={`w-full h-9 gap-1.5 text-sm ${paid ? "border-emerald-300 text-emerald-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
                    />
                  }
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : paid ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {paid ? t("unmark") : t("markPaid")}
                </TooltipTrigger>
                <TooltipContent>{paid ? t("unmarkTip") : t("markPaidTip")}</TooltipContent>
              </Tooltip>

              {/* Send this player's slip image via LINE / download */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canSlip}
                      onClick={() => setSlipOpen(true)}
                      className="w-full h-9 gap-1.5 text-sm"
                    />
                  }
                >
                  <Send className="h-4 w-4" />
                  {tSlip("sendSlip")}
                </TooltipTrigger>
                <TooltipContent>{canSlip ? tSlip("shareButton") : tSlip("noPromptpay")}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {tpl.footer_note && (
            <p className="mt-3 text-center text-xs text-muted-foreground whitespace-pre-wrap">
              {tpl.footer_note}
            </p>
          )}

          {canSlip && (
            <SlipDialog
              open={slipOpen}
              onOpenChange={setSlipOpen}
              club={club}
              row={row}
              playerName={name}
              ppNumber={ppNumber}
              qrImage={qrImage}
              qrLogoUrl={qrLogoUrl}
              locale={locale}
            />
          )}

          {(payload || ppImage) && (
            <Dialog open={zoom} onOpenChange={setZoom}>
              <DialogContent className="sm:max-w-xs">
                <DialogHeader>
                  <DialogTitle className="text-center">{name}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col items-center gap-3 py-2">
                  {payload ? (
                    <div className="rounded-lg bg-white p-3">
                      <GeneratedQr value={payload} size={240} logoUrl={qrLogoUrl} />
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ppImage!} alt={t("uploadedQr")} className="h-60 w-60 rounded-lg border bg-white object-contain p-2" />
                  )}
                  <div className="text-3xl font-bold tabular-nums">{baht(row.total)}</div>
                  <p className="text-center text-xs text-muted-foreground">
                    {payload
                      ? t("scanWith", { name: promptpayName || promptpayId || "" })
                      : t("qrImageHint", { amount: row.total.toLocaleString() })}
                  </p>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Reset all paid ─────────────────────────────────────────────────────────────

function ResetPaidButton({ clubId, onReset }: { clubId: string; onReset: () => void }) {
  const t = useTranslations("club.payment");
  const [pending, start] = useTransition();

  function reset() {
    if (!confirm(t("resetConfirm"))) return;
    onReset(); // optimistic
    start(async () => {
      const res = await resetAllPaidAction(clubId);
      if (res && "error" in res) toast.error(res.error);
    });
  }

  return (
    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset} className="h-7 gap-1 text-xs text-muted-foreground">
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
      {t("resetPaid")}
    </Button>
  );
}
