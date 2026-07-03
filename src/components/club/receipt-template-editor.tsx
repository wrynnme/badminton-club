"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { ChevronDown, ImageUp, Loader2, ReceiptText, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  updateClubReceiptTemplateAction,
  uploadClubReceiptLogoAction,
  removeClubReceiptLogoAction,
} from "@/lib/actions/club-payments";
import {
  parseReceiptTemplate,
  RECEIPT_THEME_KEYS,
  RECEIPT_THEMES,
  type ReceiptTemplate,
  type ReceiptThemeKey,
} from "@/lib/club/receipt";
import { SlipCard } from "@/components/club/club-slip-card";
import type { Club } from "@/lib/types";
import type { ClubCostRow } from "@/lib/club/cost-summary";

const FOOTER_MAX = 200;

// Deterministic sample row so the preview is stable regardless of the club's real data.
const SAMPLE_ROW: ClubCostRow = {
  playerId: "preview",
  hours: 2,
  games: 8,
  shuttles: 4,
  court: 60,
  shuttle: 40,
  expense: 20,
  discount: 10,
  total: 110,
};

type FormValues = {
  footer_note: string;
  field_court: boolean;
  field_shuttle: boolean;
  field_expense: boolean;
  field_discount: boolean;
  show_promptpay: boolean;
  show_bank: boolean;
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
  theme: ReceiptThemeKey;
};

/** Reconstruct the full ReceiptTemplate from flat form values, preserving v2-only
 * fields (theme / bank_qr) carried on the initial parsed template. */
function buildTemplate(v: FormValues, base: ReceiptTemplate): ReceiptTemplate {
  return {
    footer_note: v.footer_note,
    fields: {
      court: v.field_court,
      shuttle: v.field_shuttle,
      expense: v.field_expense,
      discount: v.field_discount,
    },
    bank: {
      name: v.bank_name,
      account_no: v.bank_account_no,
      account_name: v.bank_account_name,
    },
    payment_show: { promptpay: v.show_promptpay, bank: v.show_bank },
    theme: v.theme,
    bank_qr: base.bank_qr,
  };
}

export function ReceiptTemplateEditor({
  clubId,
  club,
  ppNumber,
  qrImage,
  qrLogoUrl,
  locale,
}: {
  clubId: string;
  club: Club;
  ppNumber: boolean;
  qrImage: string | null;
  qrLogoUrl: string | null;
  locale: string;
}) {
  const t = useTranslations("club.receipt");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [uploading, startUpload] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const initial = parseReceiptTemplate(club.receipt_template);
  const [logoUrl, setLogoUrl] = useState(club.receipt_logo_url ?? "");

  const form = useForm({
    defaultValues: {
      footer_note: initial.footer_note,
      field_court: initial.fields.court,
      field_shuttle: initial.fields.shuttle,
      field_expense: initial.fields.expense,
      field_discount: initial.fields.discount,
      show_promptpay: initial.payment_show.promptpay,
      show_bank: initial.payment_show.bank,
      bank_name: initial.bank.name,
      bank_account_no: initial.bank.account_no,
      bank_account_name: initial.bank.account_name,
      theme: initial.theme,
    } satisfies FormValues,
    onSubmit: async ({ value }) => {
      if (value.show_bank && !(value.bank_name.trim() && value.bank_account_no.trim())) {
        toast.error(t("bankIncomplete"));
        return;
      }
      start(async () => {
        const res = await updateClubReceiptTemplateAction(clubId, buildTemplate(value, initial));
        if (res && "error" in res) toast.error(res.error);
        else {
          toast.success(t("saved"));
          router.refresh();
        }
      });
    },
  });

  function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size > 1_000_000) {
      toast.error(t("logoInvalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      startUpload(async () => {
        const res = await uploadClubReceiptLogoAction({ clubId, dataUrl });
        if (res && "error" in res) toast.error(res.error);
        else {
          setLogoUrl(res.url);
          toast.success(t("saved"));
          router.refresh();
        }
      });
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    startUpload(async () => {
      const res = await removeClubReceiptLogoAction(clubId);
      if (res && "error" in res) toast.error(res.error);
      else {
        setLogoUrl("");
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
          <ReceiptText className="h-4 w-4 shrink-0 text-primary" />
          {t("configTitle")}
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="grid grid-cols-1 gap-4 px-3 pb-3 md:grid-cols-2">
            {/* ── Form ── */}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                form.handleSubmit();
              }}
            >
              {/* Footer note */}
              <form.Field name="footer_note">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("footerLabel")}</Label>
                    <Textarea
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value.slice(0, FOOTER_MAX))}
                      onBlur={field.handleBlur}
                      placeholder={t("footerPlaceholder")}
                      rows={2}
                      className="text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {field.state.value.length}/{FOOTER_MAX}
                    </p>
                  </div>
                )}
              </form.Field>

              {/* Field visibility */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("fieldsLabel")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <form.Field name="field_court">
                    {(field) => (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(Boolean(v))}
                        />
                        {t("fieldCourt")}
                      </label>
                    )}
                  </form.Field>
                  <form.Field name="field_shuttle">
                    {(field) => (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(Boolean(v))}
                        />
                        {t("fieldShuttle")}
                      </label>
                    )}
                  </form.Field>
                  <form.Field name="field_expense">
                    {(field) => (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(Boolean(v))}
                        />
                        {t("fieldExpense")}
                      </label>
                    )}
                  </form.Field>
                  <form.Field name="field_discount">
                    {(field) => (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(Boolean(v))}
                        />
                        {t("fieldDiscount")}
                      </label>
                    )}
                  </form.Field>
                </div>
                <p className="text-[11px] text-muted-foreground">{t("fieldsHint")}</p>
              </div>

              {/* Payment channels */}
              <div className="space-y-2">
                <Label className="text-xs">{t("paymentLabel")}</Label>
                <form.Field name="show_promptpay">
                  {(field) => (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={field.state.value as boolean}
                        onCheckedChange={(v) => field.handleChange(Boolean(v))}
                      />
                      {t("paymentPromptpay")}
                    </label>
                  )}
                </form.Field>
                <form.Field name="show_bank">
                  {(field) => (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={field.state.value as boolean}
                        onCheckedChange={(v) => field.handleChange(Boolean(v))}
                      />
                      {t("paymentBank")}
                    </label>
                  )}
                </form.Field>
              </div>

              {/* Bank fields — shown only when "bank" channel is on */}
              <form.Subscribe selector={(s) => s.values.show_bank}>
                {(showBank) =>
                  showBank ? (
                    <div className="space-y-2.5 rounded-lg border bg-background/60 p-3">
                      <form.Field name="bank_name">
                        {(field) => (
                          <div className="space-y-1">
                            <Label className="text-xs">{t("bankName")}</Label>
                            <Input
                              value={field.state.value}
                              onChange={(e) => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              placeholder={t("bankNamePlaceholder")}
                              className="h-8 text-sm"
                            />
                          </div>
                        )}
                      </form.Field>
                      <form.Field name="bank_account_no">
                        {(field) => (
                          <div className="space-y-1">
                            <Label className="text-xs">{t("bankAccountNo")}</Label>
                            <Input
                              inputMode="numeric"
                              value={field.state.value}
                              onChange={(e) => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              placeholder={t("bankAccountNoPlaceholder")}
                              className="h-8 text-sm"
                            />
                          </div>
                        )}
                      </form.Field>
                      <form.Field name="bank_account_name">
                        {(field) => (
                          <div className="space-y-1">
                            <Label className="text-xs">{t("bankAccountName")}</Label>
                            <Input
                              value={field.state.value}
                              onChange={(e) => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              placeholder={t("bankAccountNamePlaceholder")}
                              className="h-8 text-sm"
                            />
                          </div>
                        )}
                      </form.Field>
                    </div>
                  ) : null
                }
              </form.Subscribe>

              {/* Logo */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("logoLabel")}</Label>
                <div className="flex items-center gap-2">
                  {logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt=""
                      className="h-9 w-9 rounded-md border bg-white object-contain"
                    />
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={onPickLogo}
                  />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs"
                          disabled={uploading}
                          onClick={() => fileRef.current?.click()}
                        />
                      }
                    >
                      {uploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImageUp className="h-3.5 w-3.5" />
                      )}
                      {logoUrl ? t("logoReplace") : t("logoUpload")}
                    </TooltipTrigger>
                    <TooltipContent>{t("logoHint")}</TooltipContent>
                  </Tooltip>
                  {logoUrl && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 text-xs text-destructive"
                            disabled={uploading}
                            onClick={removeLogo}
                          />
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("logoRemove")}
                      </TooltipTrigger>
                      <TooltipContent>{t("logoRemove")}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>

              {/* Theme color */}
              <form.Field name="theme">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("themeLabel")}</Label>
                    <div className="flex flex-wrap gap-2">
                      {RECEIPT_THEME_KEYS.map((key) => {
                        const selected = field.state.value === key;
                        return (
                          <Tooltip key={key}>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  aria-label={t(`theme_${key}`)}
                                  aria-pressed={selected}
                                  onClick={() => field.handleChange(key)}
                                  className={`h-7 w-7 rounded-full p-0 ${selected ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}
                                  style={{ backgroundColor: RECEIPT_THEMES[key].headerBg }}
                                />
                              }
                            />
                            <TooltipContent>{t(`theme_${key}`)}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                )}
              </form.Field>

              {/* Save */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button type="submit" size="sm" className="h-8 gap-1.5 text-xs" disabled={pending} />
                  }
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {t("saveBtn")}
                </TooltipTrigger>
                <TooltipContent>{t("saveTip")}</TooltipContent>
              </Tooltip>
            </form>

            {/* ── Live preview ── */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("previewLabel")}</Label>
              <div className="flex justify-center overflow-x-auto rounded-lg border bg-muted/40 p-3">
                <form.Subscribe selector={(s) => s.values}>
                  {(values) => (
                    <SlipCard
                      club={{
                        ...club,
                        receipt_template: buildTemplate(values, initial),
                        receipt_logo_url: logoUrl || null,
                      }}
                      row={SAMPLE_ROW}
                      playerName={t("previewPlayer")}
                      ppNumber={ppNumber}
                      qrImage={qrImage}
                      qrLogoUrl={qrLogoUrl}
                      locale={locale}
                    />
                  )}
                </form.Subscribe>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
