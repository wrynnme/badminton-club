"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { ChevronDown, Loader2, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateClubBillingVerifySettingsAction } from "@/lib/actions/club-payments";
import type { ClubBillingVerifySettings } from "@/lib/club/billing-verify-settings";

// ─── Types ──────────────────────────────────────────────────────────────────

type FormValues = {
  mode: "manual" | "byok";
  provider: "easyslip" | "slipok" | "";
  apiKey: string;
  branchId: string;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function ClubSlipVerifyConfig({
  clubId,
  initial,
}: {
  clubId: string;
  initial: ClubBillingVerifySettings;
}) {
  const t = useTranslations("club.payment");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const form = useForm({
    defaultValues: {
      mode: initial.mode as "manual" | "byok",
      provider: (initial.provider ?? "") as "easyslip" | "slipok" | "",
      apiKey: "",
      branchId: initial.branch_id ?? "",
    },
    onSubmit: async ({ value }) => {
      // Client-side validation
      if (value.mode === "byok") {
        if (!value.provider) {
          toast.error(t("verifyByokNeedsProvider"));
          return;
        }
        if (!initial.key_set && !value.apiKey.trim()) {
          toast.error(t("verifyByokNeedsKey"));
          return;
        }
        if (value.provider === "slipok" && !value.branchId.trim()) {
          toast.error(t("verifySlipOkNeedsBranch"));
          return;
        }
      }

      start(async () => {
        const res = await updateClubBillingVerifySettingsAction(clubId, {
          mode: value.mode,
          provider: value.mode === "byok" && value.provider ? value.provider : null,
          branchId:
            value.mode === "byok" && value.provider === "slipok" && value.branchId.trim()
              ? value.branchId.trim()
              : null,
          // Only send apiKey when the user actually typed something
          ...(value.mode === "byok" && value.apiKey.trim()
            ? { apiKey: value.apiKey.trim() }
            : {}),
        });

        if ("error" in res) {
          toast.error(res.error);
        } else {
          toast.success(t("verifySaved"));
          router.refresh();
        }
      });
    },
  });

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
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          {t("verifyConfigTitle")}
          {initial.mode === "byok" && initial.key_set && (
            <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400">
              • Auto
            </span>
          )}
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <form
            className="space-y-3 px-3 pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            {/* Mode selector */}
            <form.Field name="mode">
              {(field) => (
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("verifyModeLabel")}</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(["manual", "byok"] as const).map((m) => (
                      <Button
                        key={m}
                        type="button"
                        variant={field.state.value === m ? "default" : "outline"}
                        onClick={() => field.handleChange(m)}
                        className="h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left whitespace-normal"
                      >
                        <span className="block font-medium">
                          {t(m === "manual" ? "verifyModeManual" : "verifyModeByok")}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug opacity-75">
                          {t(m === "manual" ? "verifyModeManualDesc" : "verifyModeByokDesc")}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </form.Field>

            {/* BYOK sub-fields — shown only when mode = byok */}
            <form.Subscribe selector={(s) => s.values.mode}>
              {(mode) =>
                mode === "byok" ? (
                  <div className="space-y-2.5 rounded-lg border bg-background/60 p-3">
                    {/* Provider */}
                    <form.Field name="provider">
                      {(field) => (
                        <div className="space-y-1">
                          <Label className="text-xs">{t("verifyProviderLabel")}</Label>
                          <Select
                            value={field.state.value}
                            onValueChange={(v) =>
                              field.handleChange(v as "easyslip" | "slipok" | "")
                            }
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder={t("verifyProviderPlaceholder")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="easyslip">EasySlip</SelectItem>
                              <SelectItem value="slipok">SlipOK</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </form.Field>

                    {/* API Key */}
                    <form.Field name="apiKey">
                      {(field) => (
                        <div className="space-y-1">
                          <Label className="text-xs">{t("verifyApiKeyLabel")}</Label>
                          <Input
                            type="password"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder={
                              initial.key_set
                                ? t("verifyApiKeyMaskedPlaceholder")
                                : t("verifyApiKeyPlaceholder")
                            }
                            autoComplete="off"
                            className="h-8 text-sm"
                          />
                        </div>
                      )}
                    </form.Field>

                    {/* Branch ID — only for slipok */}
                    <form.Subscribe selector={(s) => s.values.provider}>
                      {(provider) =>
                        provider === "slipok" ? (
                          <form.Field name="branchId">
                            {(field) => (
                              <div className="space-y-1">
                                <Label className="text-xs">{t("verifyBranchIdLabel")}</Label>
                                <Input
                                  value={field.state.value}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  onBlur={field.handleBlur}
                                  placeholder={t("verifyBranchPlaceholder")}
                                  className="h-8 text-sm"
                                />
                              </div>
                            )}
                          </form.Field>
                        ) : null
                      }
                    </form.Subscribe>
                  </div>
                ) : null
              }
            </form.Subscribe>

            {/* Save button */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={pending}
                  />
                }
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {t("verifySaveBtn")}
              </TooltipTrigger>
              <TooltipContent>{t("verifySaveTip")}</TooltipContent>
            </Tooltip>
          </form>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
