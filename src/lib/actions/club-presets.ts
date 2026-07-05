"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { z } from "zod";
import { getLocale, getTranslations } from "next-intl/server";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import {
  ClubPresetConfigSchema,
  parsePresetConfig,
  type ClubPresetConfig,
} from "@/lib/club/preset";
import { assertCanManageClub } from "@/lib/club/permissions";
import { parseQueueSettings } from "@/lib/club/queue-settings";
import { isValidPromptPayId } from "@/lib/club/promptpay";
import {
  DEFAULT_RECEIPT_TEMPLATE,
  hasBankReceiver,
  parseReceiptTemplate,
} from "@/lib/club/receipt";
import type { ClubPreset } from "@/lib/types";

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  let redirectTo = "/clubs";
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.pathname !== "/") redirectTo = url.pathname + url.search;
    } catch {}
  }
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
}

async function assertPresetOwner(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  presetId: string,
  profileId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("club_presets")
    .select("owner_id")
    .eq("id", presetId)
    .maybeSingle();
  // Fail closed on a transient DB error: return false (→ clean { error: "ไม่มีสิทธิ์" })
  // rather than throwing an uncaught exception that surfaces as a 500.
  if (error) return false;
  if (!data || data.owner_id !== profileId) return false;
  return true;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function validatePresetConfigPayment(
  config: ClubPresetConfig,
  t: Awaited<ReturnType<typeof getTranslations>>,
): { ok: true; config: ClubPresetConfig } | { error: string } {
  const next: ClubPresetConfig = {
    ...config,
    promptpay_id: normalizeNullableString(config.promptpay_id),
    promptpay_name: normalizeNullableString(config.promptpay_name),
    promptpay_qr_image: normalizeNullableString(config.promptpay_qr_image),
  };

  if (next.promptpay_id && !isValidPromptPayId(next.promptpay_id)) {
    return { error: t("club.invalidPromptPay") };
  }
  if (next.receipt_template.payment_show.bank && !hasBankReceiver(next.receipt_template.bank)) {
    return { error: t("club.invalidData") };
  }

  return { ok: true, config: next };
}

function receiptTemplateForPreset(config: ClubPresetConfig) {
  return {
    ...DEFAULT_RECEIPT_TEMPLATE,
    bank: config.receipt_template.bank,
    payment_show: config.receipt_template.payment_show,
    theme: config.receipt_template.theme,
  };
}

function weekdayLabel(playDate: string, locale: string): string {
  try {
    return format(new Date(`${playDate}T00:00:00`), "EEEE", {
      locale: dateFnsLocaleOf(locale),
    });
  } catch {
    return "";
  }
}

type ClubSnapshotRow = {
  id: string;
  name: string;
  venue: string;
  play_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
  court_fee: number;
  shuttle_price: number;
  courts: string[] | null;
  queue_settings: Record<string, unknown> | null;
  promptpay_id: string | null;
  promptpay_name: string | null;
  promptpay_qr_image: string | null;
  receipt_template: Record<string, unknown> | null;
};

type ClubAdminSnapshotRow = { user_id: string };

type ClubPlayerSnapshotRow = {
  display_name: string;
  profile_id: string | null;
  start_time: string | null;
  end_time: string | null;
  position: number | null;
  joined_at: string;
  status: "active" | "reserve";
};

function buildPresetConfigFromClub(input: {
  club: ClubSnapshotRow;
  admins: ClubAdminSnapshotRow[];
  players: ClubPlayerSnapshotRow[];
  locale: string;
}): ClubPresetConfig {
  const queueSettings = parseQueueSettings(input.club.queue_settings);
  const receiptTemplate = parseReceiptTemplate(input.club.receipt_template);
  const courts = Array.isArray(input.club.courts) ? input.club.courts : [];
  const courtCount = courts.length > 0 ? courts.length : queueSettings.court_count;
  const players = [...input.players].sort((a, b) => {
    const statusDiff =
      (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1);
    if (statusDiff !== 0) return statusDiff;
    const aPos = a.position ?? Number.MAX_SAFE_INTEGER;
    const bPos = b.position ?? Number.MAX_SAFE_INTEGER;
    if (aPos !== bPos) return aPos - bPos;
    return a.joined_at.localeCompare(b.joined_at);
  });

  return ClubPresetConfigSchema.parse({
    venue: input.club.venue ?? "",
    schedule_day: weekdayLabel(input.club.play_date, input.locale),
    start_time: input.club.start_time?.slice(0, 5) ?? "",
    end_time: input.club.end_time?.slice(0, 5) ?? "",
    max_players: input.club.max_players,
    court_fee: input.club.court_fee,
    shuttle_price: input.club.shuttle_price,
    court_count: courtCount,
    players_per_team: queueSettings.players_per_team,
    rotation_mode: queueSettings.rotation_mode,
    queue_mode: queueSettings.queue_mode,
    co_admin_ids: [...new Set(input.admins.map((a) => a.user_id))],
    promptpay_id: input.club.promptpay_id,
    promptpay_name: input.club.promptpay_name,
    promptpay_qr_image: input.club.promptpay_qr_image,
    receipt_template: {
      bank: receiptTemplate.bank,
      payment_show: receiptTemplate.payment_show,
      theme: receiptTemplate.theme,
    },
    regulars: players
      .filter((p) => p.display_name.trim() !== "")
      .map((p) => ({
        name: p.display_name.trim(),
        profile_id: p.profile_id,
        start_time: p.start_time,
        end_time: p.end_time,
      })),
  });
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listClubPresetsAction(): Promise<
  { presets: ClubPreset[] } | { error: string }
> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForPreset") };

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("club_presets")
    .select("id, owner_id, name, config, created_at")
    .eq("owner_id", session.profileId)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };

  const presets: ClubPreset[] = (data ?? []).map((row) => ({
    id: row.id as string,
    owner_id: row.owner_id as string,
    name: row.name as string,
    config: parsePresetConfig(row.config),
    created_at: row.created_at as string,
  }));

  return { presets };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createClubPresetAction(input: {
  name: string;
  config: ClubPresetConfig;
}): Promise<{ id: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForPresetCreate") };

  const nameResult = z.string().min(2, t("club.presetNameTooShort")).safeParse(input.name);
  if (!nameResult.success) {
    return { error: nameResult.error.issues[0]?.message ?? t("club.invalidName") };
  }

  let parsedConfig: ClubPresetConfig;
  try {
    parsedConfig = ClubPresetConfigSchema.parse(input.config);
  } catch {
    return { error: t("club.invalidConfigData") };
  }
  const paymentValidation = validatePresetConfigPayment(parsedConfig, t);
  if ("error" in paymentValidation) return { error: paymentValidation.error };
  parsedConfig = paymentValidation.config;

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("club_presets")
    .insert({ owner_id: session.profileId, name: nameResult.data, config: parsedConfig })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? t("club.createPresetFailed") };

  revalidatePath("/clubs");
  return { id: data.id as string };
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateClubPresetAction(
  presetId: string,
  input: { name?: string; config?: ClubPresetConfig },
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForPresetEdit") };

  const sb = await createAdminClient();
  if (!(await assertPresetOwner(sb, presetId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const nameResult = z.string().min(2, t("club.presetNameTooShort")).safeParse(input.name);
    if (!nameResult.success) {
      return { error: nameResult.error.issues[0]?.message ?? t("club.invalidName") };
    }
    patch.name = nameResult.data;
  }

  if (input.config !== undefined) {
    let parsedConfig: ClubPresetConfig;
    try {
      parsedConfig = ClubPresetConfigSchema.parse(input.config);
    } catch {
      return { error: t("club.invalidConfigData") };
    }
    const paymentValidation = validatePresetConfigPayment(parsedConfig, t);
    if ("error" in paymentValidation) return { error: paymentValidation.error };
    patch.config = paymentValidation.config;
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await sb.from("club_presets").update(patch).eq("id", presetId);
  if (error) return { error: error.message };

  revalidatePath("/clubs");
  return { ok: true };
}

// ─── Snapshot current club into a preset ─────────────────────────────────────

const SaveClubAsPresetSchema = z.object({
  clubId: z.string().uuid(),
  name: z.string().min(2),
  presetId: z.string().uuid().nullable().optional(),
});

export async function saveClubAsPresetAction(input: {
  clubId: string;
  name: string;
  presetId?: string | null;
}): Promise<{ id: string; mode: "created" | "updated" } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForPresetCreate") };

  const parsed = SaveClubAsPresetSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };

  const nameResult = z.string().min(2, t("club.presetNameTooShort")).safeParse(parsed.data.name);
  if (!nameResult.success) {
    return { error: nameResult.error.issues[0]?.message ?? t("club.invalidName") };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, parsed.data.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }
  if (
    parsed.data.presetId &&
    !(await assertPresetOwner(sb, parsed.data.presetId, session.profileId))
  ) {
    return { error: t("club.noPermission") };
  }

  const [clubRes, adminsRes, playersRes, locale] = await Promise.all([
    sb
      .from("clubs")
      .select(
        "id, name, venue, play_date, start_time, end_time, max_players, court_fee, shuttle_price, courts, queue_settings, promptpay_id, promptpay_name, promptpay_qr_image, receipt_template",
      )
      .eq("id", parsed.data.clubId)
      .single(),
    sb.from("club_admins").select("user_id").eq("club_id", parsed.data.clubId),
    sb
      .from("club_players")
      .select("display_name, profile_id, start_time, end_time, position, joined_at, status")
      .eq("club_id", parsed.data.clubId),
    getLocale(),
  ]);

  if (clubRes.error || !clubRes.data) {
    return { error: clubRes.error?.message ?? t("club.clubNotFound") };
  }
  if (adminsRes.error) return { error: adminsRes.error.message };
  if (playersRes.error) return { error: playersRes.error.message };

  let config = buildPresetConfigFromClub({
    club: clubRes.data as ClubSnapshotRow,
    admins: (adminsRes.data ?? []) as ClubAdminSnapshotRow[],
    players: (playersRes.data ?? []) as ClubPlayerSnapshotRow[],
    locale,
  });
  const paymentValidation = validatePresetConfigPayment(config, t);
  if ("error" in paymentValidation) return { error: paymentValidation.error };
  config = paymentValidation.config;

  if (parsed.data.presetId) {
    const { error } = await sb
      .from("club_presets")
      .update({ name: nameResult.data, config })
      .eq("id", parsed.data.presetId)
      .eq("owner_id", session.profileId);
    if (error) return { error: error.message };

    revalidatePath("/clubs");
    revalidatePath("/clubs/mine");
    revalidatePath(`/clubs/${parsed.data.clubId}`);
    return { id: parsed.data.presetId, mode: "updated" };
  }

  const { data, error } = await sb
    .from("club_presets")
    .insert({ owner_id: session.profileId, name: nameResult.data, config })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? t("club.createPresetFailed") };

  revalidatePath("/clubs");
  revalidatePath("/clubs/mine");
  revalidatePath(`/clubs/${parsed.data.clubId}`);
  return { id: data.id as string, mode: "created" };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteClubPresetAction(
  presetId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForPresetDelete") };

  const sb = await createAdminClient();
  if (!(await assertPresetOwner(sb, presetId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const { error } = await sb.from("club_presets").delete().eq("id", presetId);
  if (error) return { error: error.message };

  revalidatePath("/clubs");
  return { ok: true };
}

// ─── Profile search / name-resolution (preset co-admin + regular profile link) ─

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PresetProfileResult = {
  id: string;
  display_name: string | null;
};

/**
 * Search profiles for the co-admin picker in the preset form.
 * Guests and the calling user are excluded. Returns at most 20 results.
 */
export async function searchPresetProfilesAction(
  query: string,
  excludeIds: string[] = [],
): Promise<{ ok: true; results: PresetProfileResult[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForPreset") };

  const q = query.trim();
  if (q.length < 2) return { ok: true, results: [] };

  // Filter excludeIds to valid UUIDs only to keep the .not("id","in",...) literal safe
  const safeExcludes = [
    session.profileId,
    ...excludeIds.filter((id) => UUID_RE.test(id)),
  ];
  // Dedupe
  const uniqueExcludes = [...new Set(safeExcludes)];

  const escapedQ = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  const sb = await createAdminClient();

  // uniqueExcludes always has at least session.profileId — never empty
  const { data, error } = await sb
    .from("profiles")
    // line_user_id NOT selected (PII); used only as filter to exclude guests
    .select("id, display_name")
    .ilike("display_name", `%${escapedQ}%`)
    .not("line_user_id", "is", null)
    .not("id", "in", `(${uniqueExcludes.join(",")})`)
    .limit(20);

  if (error) return { error: t("club.searchFailed") };
  return { ok: true, results: (data ?? []) as PresetProfileResult[] };
}

/**
 * Resolve display names for a list of profile UUIDs (used to populate
 * co-admin chips and regular profile badges when editing a preset).
 */
export async function getProfileNamesAction(
  ids: string[],
): Promise<{ ok: true; results: PresetProfileResult[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForPreset") };

  // Filter to valid UUIDs, dedupe
  const safeIds = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  if (safeIds.length === 0) return { ok: true, results: [] };

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name")
    .in("id", safeIds);

  if (error) return { error: t("club.searchFailed") };
  return { ok: true, results: (data ?? []) as PresetProfileResult[] };
}

// ─── Apply ───────────────────────────────────────────────────────────────────

/**
 * One-shot seed: creates a brand-new independent club pre-filled from the
 * preset config, then inserts co-admins and regulars.
 *
 * Strategy:
 *  1. Verify ownership.
 *  2. Insert the `clubs` row — bail on error before touching children.
 *  3. Insert `club_admins` rows for co_admin_ids (skip caller + ignore 23505).
 *  4. Bulk-insert `club_players` from regulars (position 1..N, active/reserve
 *     split at max_players). Uses plain insert — no RPC — because the club is
 *     brand-new and there is no concurrency risk on an empty club.
 */
export async function applyClubPresetAction(
  presetId: string,
): Promise<{ clubId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (session.isGuest) return { error: t("club.requireLineForPreset") };

  const sb = await createAdminClient();
  if (!(await assertPresetOwner(sb, presetId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // Load + parse preset
  const { data: presetRow, error: presetErr } = await sb
    .from("club_presets")
    .select("name, config")
    .eq("id", presetId)
    .single();
  if (presetErr || !presetRow) return { error: t("club.presetNotFound") };

  const config = parsePresetConfig(presetRow.config);
  const paymentValidation = validatePresetConfigPayment(config, t);
  if ("error" in paymentValidation) return { error: paymentValidation.error };
  const validatedConfig = paymentValidation.config;

  // Derive today's date server-side (server action — Date is allowed here)
  const today = new Date().toISOString().slice(0, 10);

  // Derive courts array from court_count
  const courts = Array.from({ length: validatedConfig.court_count }, (_, i) => String(i + 1));

  // Build queue_settings from config fields
  const queueSettings = {
    court_count: validatedConfig.court_count,
    players_per_team: validatedConfig.players_per_team,
    rotation_mode: validatedConfig.rotation_mode,
    queue_mode: validatedConfig.queue_mode,
  };

  // ── Step 1: Insert clubs row ──────────────────────────────────────────────
  const { data: clubData, error: clubErr } = await sb
    .from("clubs")
    .insert({
      name: presetRow.name as string,
      venue: validatedConfig.venue || "ก๊วน",
      play_date: today,
      start_time: validatedConfig.start_time || "18:00",
      end_time: validatedConfig.end_time || "21:00",
      max_players: validatedConfig.max_players,
      court_fee: validatedConfig.court_fee,
      shuttle_price: validatedConfig.shuttle_price,
      courts,
      queue_settings: queueSettings,
      promptpay_id: validatedConfig.promptpay_id,
      promptpay_name: validatedConfig.promptpay_name,
      promptpay_qr_image: validatedConfig.promptpay_qr_image,
      receipt_template: receiptTemplateForPreset(validatedConfig),
      owner_id: session.profileId,
    })
    .select("id")
    .single();

  if (clubErr || !clubData) return { error: clubErr?.message ?? t("club.createClubFailed") };

  const clubId = clubData.id as string;

  // Compensating cleanup: deleting the club CASCADEs to club_admins/club_players,
  // so on any child-insert failure we remove the just-created club instead of
  // leaving an orphaned, half-seeded club behind.
  const rollback = async (): Promise<void> => {
    await sb.from("clubs").delete().eq("id", clubId);
  };

  // ── Step 2: Insert co-admins (dedup; never include the owner) ──────────────
  const coAdminIds = [
    ...new Set((validatedConfig.co_admin_ids ?? []).filter((uid) => uid !== session.profileId)),
  ];
  if (coAdminIds.length > 0) {
    const adminRows = coAdminIds.map((userId) => ({
      club_id: clubId,
      user_id: userId,
      added_by: session.profileId,
    }));
    const { error: adminErr } = await sb.from("club_admins").insert(adminRows);
    // A non-existent co_admin_id is a FK violation (23503), NOT 23505 — only true
    // duplicates (23505) are safe to ignore; any other error rolls back the club.
    if (adminErr && adminErr.code !== "23505") {
      await rollback();
      return { error: adminErr.message };
    }
  }

  // ── Step 3: Bulk-insert regulars ──────────────────────────────────────────
  const regulars = validatedConfig.regulars ?? [];
  if (regulars.length > 0) {
    const playerRows = regulars.map((reg, idx) => ({
      club_id: clubId,
      profile_id: reg.profile_id ?? null,
      display_name: reg.name,
      position: idx + 1,
      status: idx < validatedConfig.max_players ? "active" : "reserve",
      start_time: reg.start_time ?? null,
      end_time: reg.end_time ?? null,
    }));
    const { error: playersErr } = await sb.from("club_players").insert(playerRows);
    if (playersErr) {
      await rollback();
      return { error: playersErr.message };
    }
  }

  revalidatePath("/clubs");
  return { clubId };
}
