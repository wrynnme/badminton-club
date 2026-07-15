/**
 * line-bindings.server.ts — site-admin inventory + force-unbind helpers for
 * every ก๊วน's LINE group binding (feature: "site-admin ยกเลิกกลุ่ม LINE ทุกก๊วน",
 * locked design in spec.md § "📥 User requests" item 3, 2026-07-15). Mirrors the
 * naming/shape of `series.server.ts`.
 *
 * Binding model (ADR 0002 P1): the LIVE binding lives on
 * `club_series.line_group_id` (canonical); a per-session `clubs.line_group_id`
 * is a legacy fallback still consulted when the series has none
 * (`resolveLineGroupId`). The inventory here is the UNION of both levels,
 * DEDUPED so one ก๊วน appears once:
 *   - every `club_series` row with `line_group_id NOT NULL` (canonical), plus
 *   - every legacy `clubs` row with `line_group_id NOT NULL` whose OWN series
 *     does NOT already cover it (series_id NULL, or its series has
 *     `line_group_id` NULL) — an "orphan" legacy binding that still resolves
 *     via fallback but was never migrated onto its series.
 *
 * PII: never expose `line_user_id` or the raw `line_group_id` value out of
 * this module — `AdminLineBindingRow` carries only names/dates/an opaque
 * target (the locked design's "table shows names/dates only" rule).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { clearBindingBySeriesId } from "@/lib/club/series.server";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminLineBindingTarget =
  | { kind: "series"; seriesId: string }
  | { kind: "legacy"; clubId: string };

export type AdminLineBindingRow = {
  target: AdminLineBindingTarget;
  clubName: string;
  ownerName: string;
  /** ISO date (`clubs.play_date`) of the most recent session under this
   *  binding, or null when a bound series currently has zero sessions. */
  latestPlayDate: string | null;
};

type SeriesSource = { id: string; owner_id: string; name: string };
type SessionSource = { id: string; series_id: string | null; play_date: string; created_at: string };
type LegacyClubSource = {
  id: string;
  owner_id: string;
  name: string;
  series_id: string | null;
  play_date: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Pure inventory builder (unit-tested — see __tests__/line-bindings.test.ts)
// ---------------------------------------------------------------------------

function latestOf(sessions: SessionSource[]): SessionSource | null {
  if (sessions.length === 0) return null;
  return [...sessions].sort((a, b) => {
    const byDate = b.play_date.localeCompare(a.play_date);
    if (byDate !== 0) return byDate;
    return b.created_at.localeCompare(a.created_at);
  })[0];
}

/**
 * Build the deduped inventory from already-fetched rows (pure — no I/O).
 * `seriesSessions` must contain every `clubs` row whose `series_id` is one of
 * `boundSeries`' ids (used only to find each series' latest session).
 */
export function buildLineBindingInventory(
  boundSeries: SeriesSource[],
  seriesSessions: SessionSource[],
  legacyBoundClubs: LegacyClubSource[],
  ownerNameById: Map<string, string>,
): AdminLineBindingRow[] {
  const boundSeriesIds = new Set(boundSeries.map((s) => s.id));
  const rows: AdminLineBindingRow[] = [];

  for (const series of boundSeries) {
    const sessions = seriesSessions.filter((c) => c.series_id === series.id);
    const latest = latestOf(sessions);
    rows.push({
      target: { kind: "series", seriesId: series.id },
      clubName: series.name,
      ownerName: ownerNameById.get(series.owner_id) ?? "",
      latestPlayDate: latest?.play_date ?? null,
    });
  }

  for (const club of legacyBoundClubs) {
    // Already covered by its series' own row above — dedupe.
    if (club.series_id && boundSeriesIds.has(club.series_id)) continue;
    rows.push({
      target: { kind: "legacy", clubId: club.id },
      clubName: club.name,
      ownerName: ownerNameById.get(club.owner_id) ?? "",
      latestPlayDate: club.play_date,
    });
  }

  // Most-recently-played first; a series with zero sessions (null) sorts last.
  rows.sort((a, b) => {
    if (a.latestPlayDate === b.latestPlayDate) return 0;
    if (a.latestPlayDate === null) return 1;
    if (b.latestPlayDate === null) return -1;
    return b.latestPlayDate.localeCompare(a.latestPlayDate);
  });
  return rows;
}

// ---------------------------------------------------------------------------
// DB-glued fetch (no site-admin gate — callers check `isSiteAdmin()` first)
// ---------------------------------------------------------------------------

/** Throws on a hard query failure — callers wrap in try/catch. */
export async function fetchLineBindingInventory(sb: AdminClient): Promise<AdminLineBindingRow[]> {
  const [seriesRes, legacyRes] = await Promise.all([
    sb.from("club_series").select("id, owner_id, name").not("line_group_id", "is", null),
    sb
      .from("clubs")
      .select("id, owner_id, name, series_id, play_date, created_at")
      .not("line_group_id", "is", null),
  ]);
  if (seriesRes.error) throw seriesRes.error;
  if (legacyRes.error) throw legacyRes.error;

  const boundSeries = (seriesRes.data ?? []) as SeriesSource[];
  const legacyBoundClubs = (legacyRes.data ?? []) as LegacyClubSource[];
  const boundSeriesIds = new Set(boundSeries.map((s) => s.id));

  const seriesIds = boundSeries.map((s) => s.id);
  const sessionsRes =
    seriesIds.length > 0
      ? await sb.from("clubs").select("id, series_id, play_date, created_at").in("series_id", seriesIds)
      : { data: [] as SessionSource[], error: null };
  if (sessionsRes.error) throw sessionsRes.error;
  const seriesSessions = (sessionsRes.data ?? []) as SessionSource[];

  const ownerIds = new Set<string>();
  for (const s of boundSeries) ownerIds.add(s.owner_id);
  for (const c of legacyBoundClubs) {
    if (!(c.series_id && boundSeriesIds.has(c.series_id))) ownerIds.add(c.owner_id);
  }
  const profilesRes =
    ownerIds.size > 0
      ? await sb.from("profiles").select("id, display_name").in("id", [...ownerIds])
      : { data: [] as { id: string; display_name: string | null }[], error: null };
  if (profilesRes.error) throw profilesRes.error;
  const ownerNameById = new Map<string, string>(
    (profilesRes.data ?? []).map((p) => [p.id, p.display_name ?? ""]),
  );

  return buildLineBindingInventory(boundSeries, seriesSessions, legacyBoundClubs, ownerNameById);
}

// ---------------------------------------------------------------------------
// DB-glued clear (series targets → `clearBindingBySeriesId`; legacy → single row)
// ---------------------------------------------------------------------------

export type ClearLineBindingResult =
  | { ok: true; ownerId: string; clubName: string }
  | { ok: false };

/**
 * Force-clear one inventory row's LINE-group binding. A series target clears
 * both levels via `clearBindingBySeriesId` (the invariant's owner); a legacy
 * target clears exactly its own `clubs` row. Returns the owner id + club name
 * so the caller can push the owner notice without a second round-trip.
 */
export async function clearLineBindingByTarget(
  sb: AdminClient,
  target: AdminLineBindingTarget,
  caller: string,
): Promise<ClearLineBindingResult> {
  if (target.kind === "legacy") {
    const { data: club } = await sb
      .from("clubs")
      .select("id, owner_id, name")
      .eq("id", target.clubId)
      .maybeSingle();
    if (!club) return { ok: false };
    // An orphan legacy row IS its own binding (its series has none, by
    // inventory definition) — clear ONLY this row. Fanning out through the
    // series would wipe a sibling session's DISTINCT legacy binding that the
    // inventory lists (and the admin confirmed) as a separate row.
    const { error } = await sb.from("clubs").update({ line_group_id: null }).eq("id", target.clubId);
    if (error) {
      console.error(`[${caller}] legacy(single)`, error);
      return { ok: false };
    }
    return { ok: true, ownerId: club.owner_id, clubName: club.name };
  }

  const { data: series } = await sb
    .from("club_series")
    .select("id, owner_id, name")
    .eq("id", target.seriesId)
    .maybeSingle();
  if (!series) return { ok: false };

  const cleared = await clearBindingBySeriesId(sb, target.seriesId, "line_group_id", caller);
  if (!cleared.ok) return { ok: false };
  return { ok: true, ownerId: series.owner_id, clubName: series.name };
}
