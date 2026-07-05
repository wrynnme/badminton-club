"use client";

import * as React from "react";
import { useState, useTransition, useEffect } from "react";
import * as z from "zod";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Loader2,
  Link2,
  Unlink,
  ChevronsUpDown,
  QrCode,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  createClubPresetAction,
  updateClubPresetAction,
  searchPresetProfilesAction,
  getProfileNamesAction,
} from "@/lib/actions/club-presets";
import type { PresetProfileResult } from "@/lib/actions/club-presets";
import { fieldErrors } from "@/lib/form-errors";
import type { ClubPreset } from "@/lib/types";
import type { ClubPresetConfig } from "@/lib/club/preset";
import { isValidPromptPayId } from "@/lib/club/promptpay";
import {
  RECEIPT_THEME_KEYS,
  RECEIPT_THEMES,
  DEFAULT_RECEIPT_TEMPLATE,
  type ReceiptThemeKey,
} from "@/lib/club/receipt";

// ── Types ─────────────────────────────────────────────────────────────────────

type Regular = {
  name: string;
  start_time: string;
  end_time: string;
  profile_id: string | null;
  profile_name: string | null;
};

type FormValues = {
  name: string;
  venue: string;
  schedule_day: string;
  start_time: string;
  end_time: string;
  max_players: number;
  court_fee: number;
  shuttle_price: number;
  court_count: number;
  players_per_team: "1" | "2";
  rotation_mode: "fair_queue" | "winner_stays" | "fair_winner_fallback";
  queue_mode: "rest_longest" | "fifo" | "level_match" | "smart";
  promptpay_id: string;
  promptpay_name: string;
  promptpay_qr_image: string;
  show_promptpay: boolean;
  show_bank: boolean;
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
  receipt_theme: ReceiptThemeKey;
};

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: ClubPreset;
};

// ── Helper: preset → form defaults ───────────────────────────────────────────

function toFormDefaults(preset?: ClubPreset): FormValues {
  if (!preset) {
    return {
      name: "",
      venue: "",
      schedule_day: "",
      start_time: "",
      end_time: "",
      max_players: 12,
      court_fee: 0,
      shuttle_price: 0,
      court_count: 1,
      players_per_team: "2",
      rotation_mode: "fair_queue",
      queue_mode: "rest_longest",
      promptpay_id: "",
      promptpay_name: "",
      promptpay_qr_image: "",
      show_promptpay: DEFAULT_RECEIPT_TEMPLATE.payment_show.promptpay,
      show_bank: DEFAULT_RECEIPT_TEMPLATE.payment_show.bank,
      bank_name: "",
      bank_account_no: "",
      bank_account_name: "",
      receipt_theme: DEFAULT_RECEIPT_TEMPLATE.theme,
    };
  }
  const c = preset.config;
  return {
    name: preset.name,
    venue: c.venue,
    schedule_day: c.schedule_day,
    start_time: c.start_time,
    end_time: c.end_time,
    max_players: c.max_players,
    court_fee: c.court_fee,
    shuttle_price: c.shuttle_price,
    court_count: c.court_count,
    players_per_team: String(c.players_per_team) as "1" | "2",
    rotation_mode: c.rotation_mode,
    queue_mode: c.queue_mode,
    promptpay_id: c.promptpay_id ?? "",
    promptpay_name: c.promptpay_name ?? "",
    promptpay_qr_image: c.promptpay_qr_image ?? "",
    show_promptpay: c.receipt_template.payment_show.promptpay,
    show_bank: c.receipt_template.payment_show.bank,
    bank_name: c.receipt_template.bank.name,
    bank_account_no: c.receipt_template.bank.account_no,
    bank_account_name: c.receipt_template.bank.account_name,
    receipt_theme: c.receipt_template.theme,
  };
}

function toRegulars(preset?: ClubPreset): Regular[] {
  if (!preset) return [];
  return (preset.config.regulars ?? []).map((r) => ({
    name: r.name,
    start_time: r.start_time ?? "",
    end_time: r.end_time ?? "",
    profile_id: r.profile_id ?? null,
    // profile_name resolved later via getProfileNamesAction
    profile_name: null,
  }));
}

// ── ProfileCombobox — shared search combobox ──────────────────────────────────

type ProfileComboboxProps = {
  placeholder: string;
  inputPlaceholder: string;
  searchingText: string;
  typeToSearchText: string;
  notFoundText: string;
  noNameText: string;
  excludeIds: string[];
  onSelect: (profile: PresetProfileResult) => void;
  triggerClassName?: string;
};

function ProfileCombobox({
  placeholder,
  inputPlaceholder,
  searchingText,
  typeToSearchText,
  notFoundText,
  noNameText,
  excludeIds,
  onSelect,
  triggerClassName,
}: ProfileComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PresetProfileResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchPresetProfilesAction(q, excludeIds);
      if ("ok" in res) setResults(res.results);
      else {
        setResults([]);
        toast.error(res.error);
      }
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, excludeIds]);

  function handleSelect(profile: PresetProfileResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    onSelect(profile);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={
              triggerClassName ??
              "flex-1 h-8 justify-between font-normal"
            }
          >
            <span className="truncate">{placeholder}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
          </Button>
        }
      />
      <PopoverContent className="w-(--anchor-width) p-0 gap-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={inputPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {searching
                ? searchingText
                : query.trim().length === 0
                ? typeToSearchText
                : notFoundText}
            </CommandEmpty>
            <CommandGroup>
              {results.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.id}
                  onSelect={() => handleSelect(r)}
                >
                  <span className="truncate flex-1">
                    {r.display_name ?? noNameText}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PresetFormDialog({ open, onOpenChange, preset }: Props) {
  const t = useTranslations("club.presetForm");
  const router = useRouter();
  const isEdit = !!preset;

  const DAYS = [
    t("monday"),
    t("tuesday"),
    t("wednesday"),
    t("thursday"),
    t("friday"),
    t("saturday"),
    t("sunday"),
  ];

  const formSchema = z.object({
    name: z.string().min(2, t("validationName")),
    venue: z.string(),
    schedule_day: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    max_players: z.number().int().min(2, t("validationMaxMin")).max(40, t("validationMaxMax")),
    court_fee: z.number().min(0, t("validationFeeMin")),
    shuttle_price: z.number().min(0, t("validationFeeMin")),
    court_count: z.number().int().min(1, t("validationCourtMin")).max(20, t("validationCourtMax")),
    players_per_team: z.enum(["1", "2"]),
    rotation_mode: z.enum(["fair_queue", "winner_stays", "fair_winner_fallback"]),
    queue_mode: z.enum(["rest_longest", "fifo", "level_match", "smart"]),
    promptpay_id: z
      .string()
      .max(40)
      .refine((v) => !v.trim() || isValidPromptPayId(v), t("validationPromptPay")),
    promptpay_name: z.string().max(80),
    promptpay_qr_image: z.string().max(2048),
    show_promptpay: z.boolean(),
    show_bank: z.boolean(),
    bank_name: z.string().max(60),
    bank_account_no: z.string().max(40),
    bank_account_name: z.string().max(80),
    receipt_theme: z.enum(RECEIPT_THEME_KEYS),
  });

  // Regulars are managed outside TanStack Form (dynamic array UI),
  // then merged into the config at submit time.
  const [regulars, setRegulars] = useState<Regular[]>(() => toRegulars(preset));

  // Co-admins — separate state from regulars
  const [coAdmins, setCoAdmins] = useState<PresetProfileResult[]>([]);

  const [, startTransition] = useTransition();

  // ── Resolve names for stored IDs when opening an edit dialog ──────────────
  useEffect(() => {
    if (!open) return;

    const storedCoAdminIds = preset?.config.co_admin_ids ?? [];
    const storedRegularProfileIds = (preset?.config.regulars ?? [])
      .map((r) => r.profile_id)
      .filter((id): id is string => !!id);

    // Seed synchronously so stored ids survive an early submit or a failed
    // name lookup — names start null (rendered as "unknown") and are patched
    // by the async resolution below.
    setCoAdmins(storedCoAdminIds.map((id) => ({ id, display_name: null })));
    setRegulars(toRegulars(preset));

    const allIds = [...new Set([...storedCoAdminIds, ...storedRegularProfileIds])];
    if (allIds.length === 0) return;

    let cancelled = false;
    getProfileNamesAction(allIds)
      .then((res) => {
        if (cancelled || !("ok" in res)) return;
        const nameMap = new Map<string, string | null>();
        for (const r of res.results) nameMap.set(r.id, r.display_name);

        setCoAdmins(
          storedCoAdminIds.map((id) => ({
            id,
            display_name: nameMap.get(id) ?? null,
          })),
        );
        const baseRegulars = toRegulars(preset);
        setRegulars(
          baseRegulars.map((r) => ({
            ...r,
            profile_name: r.profile_id ? (nameMap.get(r.profile_id) ?? null) : null,
          })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset?.id]);

  const form = useForm({
    defaultValues: toFormDefaults(preset),
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const config: ClubPresetConfig = {
        venue: value.venue,
        schedule_day: value.schedule_day,
        start_time: value.start_time,
        end_time: value.end_time,
        max_players: value.max_players,
        court_fee: value.court_fee,
        shuttle_price: value.shuttle_price,
        court_count: value.court_count,
        players_per_team: Number(value.players_per_team) as 1 | 2,
        rotation_mode: value.rotation_mode,
        queue_mode: value.queue_mode,
        promptpay_id: value.promptpay_id.trim() || null,
        promptpay_name: value.promptpay_name.trim() || null,
        promptpay_qr_image: value.promptpay_qr_image.trim() || null,
        receipt_template: {
          payment_show: {
            promptpay: value.show_promptpay,
            bank: value.show_bank,
          },
          bank: {
            name: value.bank_name.trim(),
            account_no: value.bank_account_no.trim(),
            account_name: value.bank_account_name.trim(),
          },
          theme: value.receipt_theme,
        },
        co_admin_ids: coAdmins.map((a) => a.id),
        regulars: regulars
          .filter((r) => r.name.trim() !== "")
          .map((r) => ({
            name: r.name.trim(),
            profile_id: r.profile_id ?? null,
            start_time: r.start_time || null,
            end_time: r.end_time || null,
          })),
      };

      if (config.receipt_template.payment_show.bank && !config.receipt_template.bank.name.trim()) {
        toast.error(t("validationBankIncomplete"));
        return;
      }
      if (
        config.receipt_template.payment_show.bank &&
        !config.receipt_template.bank.account_no.trim()
      ) {
        toast.error(t("validationBankIncomplete"));
        return;
      }

      let res: { ok: true } | { id: string } | { error: string };
      if (isEdit) {
        res = await updateClubPresetAction(preset.id, {
          name: value.name,
          config,
        });
      } else {
        res = await createClubPresetAction({ name: value.name, config });
      }

      if ("error" in res) {
        toast.error(res.error);
        return;
      }

      toast.success(isEdit ? t("toastSaved") : t("toastCreated"));
      onOpenChange(false);
      startTransition(() => router.refresh());
    },
  });

  // Reset the form values whenever the dialog opens or the edit target changes.
  // Names are resolved by the useEffect above; here we only reset the scalar fields.
  React.useEffect(() => {
    if (open) {
      form.reset(toFormDefaults(preset));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset?.id]);

  // ── Regular helpers ────────────────────────────────────────────────────────

  function addRegular() {
    setRegulars((prev) => [
      ...prev,
      { name: "", start_time: "", end_time: "", profile_id: null, profile_name: null },
    ]);
  }

  function removeRegular(idx: number) {
    setRegulars((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRegular(idx: number, patch: Partial<Regular>) {
    setRegulars((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  }

  // ── Co-admin helpers ───────────────────────────────────────────────────────

  function addCoAdmin(profile: PresetProfileResult) {
    setCoAdmins((prev) => {
      if (prev.some((a) => a.id === profile.id)) return prev;
      return [...prev, profile];
    });
  }

  function removeCoAdmin(id: string) {
    setCoAdmins((prev) => prev.filter((a) => a.id !== id));
  }

  // IDs already used so comboboxes can exclude them
  const coAdminIds = coAdmins.map((a) => a.id);
  const linkedRegularProfileIds = regulars
    .map((r) => r.profile_id)
    .filter((id): id is string => !!id);

  // ── Numeric field ──────────────────────────────────────────────────────────
  function numberField(
    name: "max_players" | "court_count" | "court_fee" | "shuttle_price",
    label: string,
    min: number,
    max?: number,
  ) {
    return (
      <form.Field
        name={name}
        children={(field) => {
          const isInvalid =
            field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
              <Input
                id={field.name}
                type="number"
                min={min}
                max={max}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(Number(e.target.value))}
                aria-invalid={isInvalid}
                className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              {isInvalid && (
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              )}
            </Field>
          );
        }}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("titleEdit") : t("titleCreate")}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            {/* ── Name ─────────────────────────────────────────────────── */}
            <form.Field
              name="name"
              children={(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t("nameLabel")}</FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                      placeholder={t("namePlaceholder")}
                    />
                    {isInvalid && (
                      <FieldError errors={fieldErrors(field.state.meta.errors)} />
                    )}
                  </Field>
                );
              }}
            />

            {/* ── Venue ────────────────────────────────────────────────── */}
            <form.Field
              name="venue"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{t("venueLabel")}</FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={t("venuePlaceholder")}
                  />
                </Field>
              )}
            />

            {/* ── Schedule day ─────────────────────────────────────────── */}
            <form.Field
              name="schedule_day"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={`${field.name}-trigger`}>{t("scheduleDayLabel")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      if (v) field.handleChange(v);
                    }}
                  >
                    <SelectTrigger id={`${field.name}-trigger`} className="w-full">
                      <SelectValue>
                        {(v: string) => v || <span className="text-muted-foreground">{t("scheduleDayPlaceholder")}</span>}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.state.value && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-2 text-left mt-0.5"
                      onClick={() => field.handleChange("")}
                    >
                      {t("scheduleDayClear")}
                    </button>
                  )}
                </Field>
              )}
            />

            {/* ── Time ─────────────────────────────────────────────────── */}
            <Field>
              <FieldLabel>{t("timeLabel")}</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <form.Field
                  name="start_time"
                  children={(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                        {t("timeStart")}
                      </FieldLabel>
                      <Input
                        id={field.name}
                        type="time"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                />
                <form.Field
                  name="end_time"
                  children={(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name} className="text-xs text-muted-foreground">
                        {t("timeEnd")}
                      </FieldLabel>
                      <Input
                        id={field.name}
                        type="time"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                />
              </div>
            </Field>

            {/* ── Max players ──────────────────────────────────────────── */}
            {numberField("max_players", t("maxPlayersLabel"), 2, 40)}

            {/* ── Court count ──────────────────────────────────────────── */}
            {numberField("court_count", t("courtCountLabel"), 1, 20)}

            {/* ── Court fee ────────────────────────────────────────────── */}
            {numberField("court_fee", t("courtFeeLabel"), 0)}

            {/* ── Shuttle price ─────────────────────────────────────────── */}
            {numberField("shuttle_price", t("shuttlePriceLabel"), 0)}

            {/* ── Players per team ──────────────────────────────────────── */}
            <form.Field
              name="players_per_team"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={`${field.name}-trigger`}>{t("playersPerTeamLabel")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      if (v) field.handleChange(v as "1" | "2");
                    }}
                  >
                    <SelectTrigger id={`${field.name}-trigger`} className="w-full">
                      <SelectValue>
                        {(v: string) => (v === "1" ? t("playersPerTeamSingle") : t("playersPerTeamDouble"))}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{t("playersPerTeamSingle")}</SelectItem>
                      <SelectItem value="2">{t("playersPerTeamDouble")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />

            {/* ── Rotation mode ─────────────────────────────────────────── */}
            <form.Field
              name="rotation_mode"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={`${field.name}-trigger`}>{t("rotationModeLabel")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      if (v)
                        field.handleChange(v as "fair_queue" | "winner_stays" | "fair_winner_fallback");
                    }}
                  >
                    <SelectTrigger id={`${field.name}-trigger`} className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          v === "fair_queue"
                            ? t("rotationFairQueue")
                            : v === "winner_stays"
                              ? t("rotationWinnerStays")
                              : t("rotationFairWinnerFallback")
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fair_queue">
                        {t("rotationFairQueue")}
                      </SelectItem>
                      <SelectItem value="winner_stays">
                        {t("rotationWinnerStays")}
                      </SelectItem>
                      <SelectItem value="fair_winner_fallback">
                        {t("rotationFairWinnerFallback")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />

            {/* ── Queue mode ────────────────────────────────────────────── */}
            <form.Field
              name="queue_mode"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={`${field.name}-trigger`}>{t("queueModeLabel")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      if (v)
                        field.handleChange(
                          v as
                            | "rest_longest"
                            | "fifo"
                            | "level_match"
                            | "smart",
                        );
                    }}
                  >
                    <SelectTrigger id={`${field.name}-trigger`} className="w-full">
                      <SelectValue>
                        {(v: string) => {
                          if (v === "rest_longest") return t("queueRestLongest");
                          if (v === "fifo") return t("queueFifo");
                          if (v === "level_match") return t("queueLevelMatch");
                          if (v === "smart") return t("queueSmart");
                          return v;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rest_longest">
                        {t("queueRestLongest")}
                      </SelectItem>
                      <SelectItem value="fifo">{t("queueFifo")}</SelectItem>
                      <SelectItem value="level_match">{t("queueLevelMatch")}</SelectItem>
                      <SelectItem value="smart">{t("queueSmart")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />

            {/* ── Payment receiver ─────────────────────────────────────── */}
            <Field>
              <FieldLabel className="flex items-center gap-1.5">
                <QrCode className="h-4 w-4 text-muted-foreground" />
                {t("paymentReceiverLabel")}
              </FieldLabel>
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <form.Field
                    name="promptpay_id"
                    children={(field) => {
                      const isInvalid =
                        field.state.meta.isTouched && !field.state.meta.isValid;
                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>
                            {t("promptpayIdLabel")}
                          </FieldLabel>
                          <Input
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder={t("promptpayIdPlaceholder")}
                            inputMode="numeric"
                            aria-invalid={isInvalid}
                          />
                          {isInvalid && (
                            <FieldError errors={fieldErrors(field.state.meta.errors)} />
                          )}
                        </Field>
                      );
                    }}
                  />
                  <form.Field
                    name="promptpay_name"
                    children={(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>
                          {t("promptpayNameLabel")}
                        </FieldLabel>
                        <Input
                          id={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder={t("promptpayNamePlaceholder")}
                        />
                      </Field>
                    )}
                  />
                </div>

                <form.Field
                  name="promptpay_qr_image"
                  children={(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>{t("qrImageUrlLabel")}</FieldLabel>
                      <div className="flex items-center gap-2">
                        {field.state.value.trim() && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={field.state.value.trim()}
                            alt=""
                            className="h-10 w-10 rounded-md border bg-white object-contain"
                          />
                        )}
                        <Input
                          id={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder={t("qrImageUrlPlaceholder")}
                          className="min-w-0 flex-1"
                        />
                        {field.state.value.trim() && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => field.handleChange("")}
                          >
                            {t("qrImageClear")}
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("qrImageUrlHint")}
                      </p>
                    </Field>
                  )}
                />

                <div className="space-y-2">
                  <Label className="text-xs">{t("paymentChannelsLabel")}</Label>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <form.Field
                      name="show_promptpay"
                      children={(field) => (
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={field.state.value}
                            onCheckedChange={(v) => field.handleChange(Boolean(v))}
                          />
                          {t("paymentPromptpay")}
                        </label>
                      )}
                    />
                    <form.Field
                      name="show_bank"
                      children={(field) => (
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={field.state.value}
                            onCheckedChange={(v) => field.handleChange(Boolean(v))}
                          />
                          {t("paymentBank")}
                        </label>
                      )}
                    />
                  </div>
                </div>

                <form.Subscribe selector={(s) => s.values.show_bank}>
                  {(showBank) =>
                    showBank ? (
                      <div className="grid gap-2 rounded-lg border bg-background/60 p-3 sm:grid-cols-3">
                        <form.Field
                          name="bank_name"
                          children={(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                {t("bankNameLabel")}
                              </FieldLabel>
                              <Input
                                id={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                                placeholder={t("bankNamePlaceholder")}
                              />
                            </Field>
                          )}
                        />
                        <form.Field
                          name="bank_account_no"
                          children={(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                {t("bankAccountNoLabel")}
                              </FieldLabel>
                              <Input
                                id={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                                placeholder={t("bankAccountNoPlaceholder")}
                                inputMode="numeric"
                              />
                            </Field>
                          )}
                        />
                        <form.Field
                          name="bank_account_name"
                          children={(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                {t("bankAccountNameLabel")}
                              </FieldLabel>
                              <Input
                                id={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                                placeholder={t("bankAccountNamePlaceholder")}
                              />
                            </Field>
                          )}
                        />
                      </div>
                    ) : null
                  }
                </form.Subscribe>

                <form.Field
                  name="receipt_theme"
                  children={(field) => (
                    <Field>
                      <FieldLabel>{t("receiptThemeLabel")}</FieldLabel>
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
                    </Field>
                  )}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("paymentReceiverNote")}
              </p>
            </Field>

            {/* ── Co-admins ─────────────────────────────────────────────── */}
            <Field>
              <FieldLabel>{t("coAdminsLabel")}</FieldLabel>
              <div className="space-y-2">
                {/* Selected co-admin list */}
                {coAdmins.length > 0 && (
                  <ul className="space-y-1">
                    {coAdmins.map((admin) => {
                      const displayName =
                        admin.display_name ?? t("coAdminUnknownProfile");
                      return (
                        <li
                          key={admin.id}
                          className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm"
                        >
                          <span className="truncate flex-1">{displayName}</span>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t("coAdminRemoveAria", {
                                    name: displayName,
                                  })}
                                  onClick={() => removeCoAdmin(admin.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              }
                            />
                            <TooltipContent>
                              {t("coAdminRemoveAria", { name: displayName })}
                            </TooltipContent>
                          </Tooltip>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Selecting a result in the combobox adds the co-admin immediately */}
                <ProfileCombobox
                  placeholder={t("coAdminPlaceholder")}
                  inputPlaceholder={t("coAdminInputPlaceholder")}
                  searchingText={t("coAdminSearching")}
                  typeToSearchText={t("coAdminTypeToSearch")}
                  notFoundText={t("coAdminNotFound")}
                  noNameText={t("coAdminUnknownProfile")}
                  excludeIds={coAdminIds}
                  onSelect={addCoAdmin}
                  triggerClassName="w-full h-8 justify-between font-normal"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("coAdminsNote")}
              </p>
            </Field>

            {/* ── Regulars ──────────────────────────────────────────────── */}
            <Field>
              <FieldLabel>{t("regularsLabel")}</FieldLabel>
              <div className="space-y-2">
                {regulars.map((reg, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={reg.name}
                        onChange={(e) =>
                          updateRegular(idx, { name: e.target.value })
                        }
                        placeholder={t("regularPlayerPlaceholder", {
                          number: idx + 1,
                        })}
                        className="flex-1 min-w-0"
                      />
                      <Input
                        type="time"
                        value={reg.start_time}
                        onChange={(e) =>
                          updateRegular(idx, { start_time: e.target.value })
                        }
                        className="w-24 shrink-0"
                        title={t("regularStartTimeTitle")}
                      />
                      <Input
                        type="time"
                        value={reg.end_time}
                        onChange={(e) =>
                          updateRegular(idx, { end_time: e.target.value })
                        }
                        className="w-24 shrink-0"
                        title={t("regularEndTimeTitle")}
                      />

                      {/* Link / Unlink profile button */}
                      {reg.profile_id ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("unlinkProfileTooltip")}
                                onClick={() =>
                                  updateRegular(idx, {
                                    profile_id: null,
                                    profile_name: null,
                                  })
                                }
                              >
                                <Unlink className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            }
                          />
                          <TooltipContent>
                            {t("unlinkProfileTooltip")}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <RegularProfilePicker
                          idx={idx}
                          excludeIds={[
                            ...linkedRegularProfileIds.filter(
                              (id) => id !== reg.profile_id,
                            ),
                          ]}
                          onSelect={(profile) => {
                            updateRegular(idx, {
                              profile_id: profile.id,
                              profile_name: profile.display_name,
                              // Autofill name if empty
                              name:
                                reg.name.trim() === ""
                                  ? (profile.display_name ?? reg.name)
                                  : reg.name,
                            });
                          }}
                          linkTooltip={t("linkProfileTooltip")}
                          inputPlaceholder={t("profileSearchPlaceholder")}
                          searchingText={t("coAdminSearching")}
                          typeToSearchText={t("coAdminTypeToSearch")}
                          notFoundText={t("coAdminNotFound")}
                          noNameText={t("coAdminUnknownProfile")}
                        />
                      )}

                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeRegular(idx)}
                              aria-label={t("regularRemoveAriaLabel")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        <TooltipContent>
                          {t("regularRemoveAriaLabel")}
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Linked profile badge */}
                    {reg.profile_id && (
                      <div className="pl-0">
                        <Badge
                          variant="secondary"
                          className="text-xs font-normal"
                        >
                          <Link2 className="h-3 w-3 mr-1" />
                          {t("linkedProfileBadge", {
                            name:
                              reg.profile_name ??
                              t("coAdminUnknownProfile"),
                          })}
                        </Badge>
                      </div>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={addRegular}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t("addRegularButton")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("regularsNote")}
              </p>
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-4">
            <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="w-full sm:w-auto"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {isEdit ? t("submitting") : t("creating")}
                    </>
                  ) : isEdit ? (
                    t("savePreset")
                  ) : (
                    t("createPreset")
                  )}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── RegularProfilePicker — icon button + inline popover for a single regular ──

type RegularProfilePickerProps = {
  idx: number;
  excludeIds: string[];
  onSelect: (profile: PresetProfileResult) => void;
  linkTooltip: string;
  inputPlaceholder: string;
  searchingText: string;
  typeToSearchText: string;
  notFoundText: string;
  noNameText: string;
};

function RegularProfilePicker({
  excludeIds,
  onSelect,
  linkTooltip,
  inputPlaceholder,
  searchingText,
  typeToSearchText,
  notFoundText,
  noNameText,
}: RegularProfilePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PresetProfileResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchPresetProfilesAction(q, excludeIds);
      if ("ok" in res) setResults(res.results);
      else {
        setResults([]);
        toast.error(res.error);
      }
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, excludeIds, open]);

  function handleSelect(profile: PresetProfileResult) {
    onSelect(profile);
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setQuery("");
          setResults([]);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={linkTooltip}
                >
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              }
            />
          }
        />
        <TooltipContent>{linkTooltip}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64 p-0 gap-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={inputPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {searching
                ? searchingText
                : query.trim().length === 0
                ? typeToSearchText
                : notFoundText}
            </CommandEmpty>
            <CommandGroup>
              {results.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.id}
                  onSelect={() => handleSelect(r)}
                >
                  <span className="truncate flex-1">
                    {r.display_name ?? noNameText}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
