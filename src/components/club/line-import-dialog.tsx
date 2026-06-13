"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ClipboardPaste, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseLineSignup } from "@/lib/club/line-signup";
import { importClubPlayersAction } from "@/lib/actions/club-players";
import type { ImportPlayerItem } from "@/lib/actions/club-players";

type Props = {
  clubId: string;
  existingNames: string[];
};

type ParsedRow = {
  name: string;
  start_time: string | null;
  end_time: string | null;
  isExisting: boolean;
  isDuplicate: boolean;
  checked: boolean;
};

type Step = "input" | "preview";

export function LineImportDialog({ clubId, existingNames }: Props) {
  const t = useTranslations("club.lineImport");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [mainRows, setMainRows] = useState<ParsedRow[]>([]);
  const [reserveRows, setReserveRows] = useState<ParsedRow[]>([]);
  const [isPending, startTransition] = useTransition();
  // Separate transition for the parse step — the parse itself is instant, but
  // rendering the ~40-row preview takes a beat; this keeps the button showing
  // a spinner until the preview is painted.
  const [isParsing, startParse] = useTransition();

  const existingLower = new Set(existingNames.map((n) => n.trim().toLowerCase()));

  function handleParse() {
    startParse(() => {
      const { players, reserves } = parseLineSignup(text);

      function buildRows(items: { name: string; start_time: string | null; end_time: string | null }[]): ParsedRow[] {
        const seen = new Set<string>();
        return items.map((item) => {
          const key = item.name.trim().toLowerCase();
          const isExisting = existingLower.has(key);
          const isDuplicate = seen.has(key);
          seen.add(key);
          return {
            name: item.name,
            start_time: item.start_time,
            end_time: item.end_time,
            isExisting,
            isDuplicate,
            // Default unchecked when already in club or is a duplicate in the batch
            checked: !isExisting && !isDuplicate,
          };
        });
      }

      setMainRows(buildRows(players));
      setReserveRows(buildRows(reserves));
      setStep("preview");
    });
  }

  function toggleMain(idx: number) {
    setMainRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, checked: !r.checked } : r)),
    );
  }

  function toggleReserve(idx: number) {
    setReserveRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, checked: !r.checked } : r)),
    );
  }

  function handleReset() {
    setStep("input");
    setText("");
    setMainRows([]);
    setReserveRows([]);
  }

  function handleClose() {
    setOpen(false);
    handleReset();
  }

  function rowToItem(r: ParsedRow): ImportPlayerItem {
    return { name: r.name, start_time: r.start_time ?? null, end_time: r.end_time ?? null };
  }

  function handleConfirm() {
    const checkedMain = mainRows.filter((r) => r.checked).map(rowToItem);
    const checkedReserves = reserveRows.filter((r) => r.checked).map(rowToItem);

    if (checkedMain.length + checkedReserves.length === 0) {
      toast.error(t("toastNoSelection"));
      return;
    }

    startTransition(async () => {
      const res = await importClubPlayersAction({
        club_id: clubId,
        players: checkedMain,
        reserve_players: checkedReserves,
      });

      if ("error" in res) {
        toast.error(res.error);
        return;
      }

      toast.success(
        t("toastSuccess", {
          added: res.added,
          reserved: res.reserved,
          skipped: res.skipped,
        }),
      );
      handleClose();
      router.refresh();
    });
  }

  const selectedCount =
    mainRows.filter((r) => r.checked).length +
    reserveRows.filter((r) => r.checked).length;

  const noNamesFound =
    step === "preview" && mainRows.length === 0 && reserveRows.length === 0;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              aria-label={t("triggerButton")}
            />
          }
        >
          <ClipboardPaste className="h-4 w-4 mr-1" />
          {t("triggerButton")}
        </TooltipTrigger>
        <TooltipContent>{t("triggerTooltip")}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
          </DialogHeader>

          {step === "input" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("step1Label")}</p>
              <Textarea
                placeholder={t("textareaPlaceholder")}
                value={text}
                onChange={(e) => setText(e.target.value)}
                // field-sizing-fixed overrides the base field-sizing-content so a
                // long pasted message scrolls inside the box instead of growing it
                // and pushing the parse button off-screen.
                className="field-sizing-fixed h-56 max-h-[45dvh] resize-none text-sm overflow-y-auto"
                autoFocus
              />
              <div className="flex justify-end">
                <Button
                  onClick={handleParse}
                  disabled={!text.trim() || isParsing}
                  size="sm"
                >
                  {isParsing && (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  )}
                  {isParsing ? t("parsing") : t("parseButton")}
                </Button>
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              {noNamesFound ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("emptyResult")}
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("step2Summary", {
                      players: mainRows.length,
                      reserves: reserveRows.length,
                    })}
                  </p>

                  <div className="max-h-72 overflow-y-auto space-y-4 pr-1">
                    {mainRows.length > 0 && (
                      <section className="space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {t("groupMain", { count: mainRows.length })}
                        </p>
                        {mainRows.map((row, idx) => (
                          <NameRow
                            key={`main-${idx}`}
                            row={row}
                            onToggle={() => toggleMain(idx)}
                            badgeExists={t("badgeExists")}
                            badgeDuplicate={t("badgeDuplicate")}
                          />
                        ))}
                      </section>
                    )}

                    {reserveRows.length > 0 && (
                      <section className="space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {t("groupReserve", { count: reserveRows.length })}
                        </p>
                        {reserveRows.map((row, idx) => (
                          <NameRow
                            key={`res-${idx}`}
                            row={row}
                            onToggle={() => toggleReserve(idx)}
                            badgeExists={t("badgeExists")}
                            badgeDuplicate={t("badgeDuplicate")}
                          />
                        ))}
                      </section>
                    )}
                  </div>
                </>
              )}

              <div className="flex justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  disabled={isPending}
                >
                  {t("backButton")}
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirm}
                  disabled={isPending || selectedCount === 0}
                >
                  {isPending
                    ? t("adding")
                    : t("confirmButton", { count: selectedCount })}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Sub-component ────────────────────────────────────────────────────────────

type NameRowProps = {
  row: ParsedRow;
  onToggle: () => void;
  badgeExists: string;
  badgeDuplicate: string;
};

function NameRow({ row, onToggle, badgeExists, badgeDuplicate }: NameRowProps) {
  const timeChip =
    row.start_time && row.end_time ? `${row.start_time}–${row.end_time}` : null;

  return (
    <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer">
      <Checkbox checked={row.checked} onCheckedChange={onToggle} />
      <span className="flex-1 text-sm truncate">{row.name}</span>
      {timeChip && (
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
          {timeChip}
        </span>
      )}
      {row.isExisting && (
        <Badge variant="secondary" className="text-xs shrink-0">
          {badgeExists}
        </Badge>
      )}
      {!row.isExisting && row.isDuplicate && (
        <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
          {badgeDuplicate}
        </Badge>
      )}
    </label>
  );
}
