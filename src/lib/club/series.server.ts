/**
 * series.server.ts — server-only helpers for the club series (ก๊วนถาวร) entity
 * introduced in ADR 0002 (`docs/adr/0002-club-series-persistent-entity.md`).
 * Mirrors the naming/shape of `tournament/settings.server.ts`.
 *
 * A `club_series` row is the persistent real-world club ("MUGGLE") that a
 * `clubs` row (a นัด / session) belongs to. LINE group binding + join link +
 * the member registry live here, "once, forever" — never on the per-session
 * row. See CONTEXT.md § "Club series (ก๊วนถาวร + นัด)" for the glossary.
 *
 * P1 scope (this file): resolve helpers used by the webhook, group billing,
 * and join-link flows to repoint reads/writes at the series while legacy
 * `clubs.line_group_id` / `clubs.join_token` stay readable as a fallback
 * (EXPAND/contract discipline — no legacy column drops until CONTRACT).
 */

import { createAdminClient } from "@/lib/supabase/server";
import type { Club, ClubSeries } from "@/lib/types";
import { classifyRosterMatch } from "@/lib/club/line-self-link";
import { buildSessionDefaultsFromClub } from "@/lib/club/session-defaults";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

// ---------------------------------------------------------------------------
// Lookup / lazy-attach
// ---------------------------------------------------------------------------

/** The series a session (`clubs` row) belongs to, or null if not yet migrated. */
export async function getSeriesForClub(sb: AdminClient, clubId: string): Promise<ClubSeries | null> {
  // One round-trip via the FK embed (clubs.series_id -> club_series.id) instead
  // of two sequential lookups.
  const { data } = await sb
    .from("clubs")
    .select("series:club_series!series_id(*)")
    .eq("id", clubId)
    .maybeSingle();
  return ((data as unknown as { series: ClubSeries | null } | null)?.series) ?? null;
}

/**
 * Returns the series for `clubId`, lazily attaching/creating one if this session
 * predates the ADR 0002 backfill (all 8 prod clubs were migrated 2026-07-15, so
 * this path is expected only for a club created between backfill and P1 ship).
 *
 * SAME rule as the backfill migration (`20260715000300_club_series_backfill.sql`):
 * group by exact `(owner_id, name)` — attach to an existing series if one already
 * matches, else create a new one seeded from THIS club's config (session_defaults
 * shape mirrors the backfill: venue/start_time/end_time/max_players/court_fee/
 * shuttle_price/court_split/shuttle_split/courts/queue_settings).
 *
 * MUTATES (attaches `clubs.series_id`, may insert a `club_series` row) — never
 * call this from a GET render; use `getSeriesForClub` there and tolerate null.
 */
export async function ensureSeriesForClub(sb: AdminClient, clubId: string): Promise<ClubSeries> {
  const existing = await getSeriesForClub(sb, clubId);
  if (existing) return existing;

  const { data: club, error: clubErr } = await sb
    .from("clubs")
    .select("*")
    .eq("id", clubId)
    .maybeSingle();
  if (clubErr || !club) {
    throw new Error(`ensureSeriesForClub: club ${clubId} not found: ${clubErr?.message ?? "no row"}`);
  }
  const row = club as Club;

  const { data: matched } = await sb
    .from("club_series")
    .select("*")
    .eq("owner_id", row.owner_id)
    .eq("name", row.name)
    .maybeSingle();

  let series = matched as ClubSeries | null;
  if (!series) {
    // Lift the club's legacy LINE bindings onto the new series (same "latest
    // non-null wins" rule as the backfill — here there's exactly one session).
    // Without this, a pre-bound club that gets its series lazily would leave
    // `series.line_group_id` NULL, and decision #14's direction-B conflict check
    // would let `ผูกก๊วน` in a NEW group silently shadow the old binding.
    const base = {
      owner_id: row.owner_id,
      name: row.name,
      active_session_id: row.id,
      session_defaults: buildSessionDefaultsFromClub(row),
    };
    let { data: created, error: createErr } = await sb
      .from("club_series")
      .insert({ ...base, line_group_id: row.line_group_id, join_token: row.join_token })
      .select("*")
      .single();
    if (createErr?.code === "23505") {
      // A different series already claims this group/token (stale legacy value) —
      // create unbound instead; the conflict checks stay authoritative.
      ({ data: created, error: createErr } = await sb
        .from("club_series")
        .insert(base)
        .select("*")
        .single());
    }
    if (createErr || !created) {
      throw new Error(`ensureSeriesForClub: create failed for club ${clubId}: ${createErr?.message}`);
    }
    series = created as ClubSeries;
  }

  const { error: attachErr } = await sb.from("clubs").update({ series_id: series.id }).eq("id", clubId);
  if (attachErr) {
    throw new Error(`ensureSeriesForClub: attach failed for club ${clubId}: ${attachErr.message}`);
  }

  return series;
}

// ---------------------------------------------------------------------------
// Token / group-id resolve (webhook + join link entry points)
// ---------------------------------------------------------------------------

/** Series bound to a join token at the series level (decision #15 — the "living preset"). */
export async function findSeriesByJoinToken(sb: AdminClient, token: string): Promise<ClubSeries | null> {
  const { data } = await sb.from("club_series").select("*").eq("join_token", token).maybeSingle();
  return (data as ClubSeries | null) ?? null;
}

/** Series bound to a LINE group at the series level (decision #14 — the durable binding). */
export async function findSeriesByGroupId(sb: AdminClient, groupId: string): Promise<ClubSeries | null> {
  const { data } = await sb.from("club_series").select("*").eq("line_group_id", groupId).maybeSingle();
  return (data as ClubSeries | null) ?? null;
}

export type SeriesEntry = {
  series: ClubSeries;
  /** The series' active session (decision #3), or the legacy-matched club when
   *  the series has no active pointer yet. Null when neither resolves. */
  activeClub: { id: string; name: string } | null;
};

/**
 * Core "resolve a series (and its active session) from an inbound key" walk,
 * shared by every mutating entry point: find the series at the series level
 * first, else fall back to a legacy per-session `clubs.<column>` match and
 * lazily attach/create a series for it (`ensureSeriesForClub` — MUTATES, so
 * this core is not safe to call from a GET render; see the read-only walk
 * hand-rolled in `/clubs/join/[token]/page.tsx` instead).
 */
async function resolveSeriesEntryCore(
  sb: AdminClient,
  column: "join_token" | "line_group_id",
  value: string,
): Promise<SeriesEntry | null> {
  let series =
    column === "join_token" ? await findSeriesByJoinToken(sb, value) : await findSeriesByGroupId(sb, value);

  let legacyClub: { id: string; name: string } | null = null;
  if (!series) {
    const { data } = await sb.from("clubs").select("id, name").eq(column, value).maybeSingle();
    if (!data) return null;
    legacyClub = data;
    series = await ensureSeriesForClub(sb, data.id);
  }

  const targetClubId = series.active_session_id ?? legacyClub?.id ?? null;
  const activeClub = targetClubId
    ? ((await sb.from("clubs").select("id, name").eq("id", targetClubId).maybeSingle()).data as {
        id: string;
        name: string;
      } | null)
    : null;

  return { series, activeClub };
}

/** Resolve a series (+ active session) from a join token — series-level `join_token`
 *  first, else a legacy `clubs.join_token` lazily migrated onto its series. */
export async function resolveSeriesEntryByToken(sb: AdminClient, token: string): Promise<SeriesEntry | null> {
  return resolveSeriesEntryCore(sb, "join_token", token);
}

/** Resolve a series (+ active session) from a LINE group id — series-level
 *  `line_group_id` first, else a legacy `clubs.line_group_id` lazily migrated
 *  onto its series. */
export async function resolveSeriesEntryByGroupId(sb: AdminClient, groupId: string): Promise<SeriesEntry | null> {
  return resolveSeriesEntryCore(sb, "line_group_id", groupId);
}

/**
 * The effective LINE group id for a session: the series binding, falling back to
 * the legacy per-session column for any club not yet migrated. Once a series is
 * bound (`series.line_group_id` set), the legacy column is never consulted again
 * for that series — see the "sharpest trap" note on `clearSeriesBinding`.
 */
export function resolveLineGroupId(
  series: Pick<ClubSeries, "line_group_id"> | null,
  club: Pick<Club, "line_group_id">,
): string | null {
  return series?.line_group_id ?? club.line_group_id ?? null;
}

/**
 * The effective join token for a session: the series token (decision #15 — one
 * stable link across sessions), falling back to the legacy per-session column.
 * Unlike LINE-group binding, a join token is intentionally NOT exclusive — old
 * legacy links are left alone and keep working as separate aliases into the same
 * series (see generateClubJoinTokenAction / revokeClubJoinTokenAction).
 */
export function resolveJoinToken(
  series: Pick<ClubSeries, "join_token"> | null,
  club: Pick<Club, "join_token">,
): string | null {
  return series?.join_token ?? club.join_token ?? null;
}

/**
 * Read-only conflict check for decision #14 (webhook rebind, explicit error both
 * directions): is `groupId` already bound to a DIFFERENT series than
 * `targetSeriesId` — either at series level, or still sitting on a legacy
 * `clubs.line_group_id` that belongs to a different (or not-yet-migrated) series?
 * Returns the name to show in the bot's reply, or null when there's no conflict.
 * Pure read — never mutates (a conflict check must not side-effect a bind).
 */
export async function findGroupBindingConflict(
  sb: AdminClient,
  groupId: string,
  targetSeriesId: string,
): Promise<{ name: string } | null> {
  const { data: boundSeries } = await sb
    .from("club_series")
    .select("id, name")
    .eq("line_group_id", groupId)
    .maybeSingle();
  if (boundSeries) {
    return boundSeries.id !== targetSeriesId ? { name: boundSeries.name as string } : null;
  }

  const { data: legacyClub } = await sb
    .from("clubs")
    .select("id, name, series_id")
    .eq("line_group_id", groupId)
    .maybeSingle();
  if (legacyClub && legacyClub.series_id !== targetSeriesId) {
    return { name: legacyClub.name as string };
  }
  return null;
}

/**
 * Clear a binding column (`join_token` | `line_group_id`) so it stops resolving.
 *
 * ADR 0002 P1 — the sharpest trap in this cutover: the binding must be cleared at
 * BOTH levels. `resolveLineGroupId`/`resolveJoinToken` fall back to the legacy
 * `clubs.<column>` whenever the series column is null, so clearing ONLY
 * `club_series.<column>` would silently resurrect the old binding on the very
 * next read. Every session under the series is cleared, not just the current
 * one — any of them could still hold the stale legacy value. A club with no
 * series yet falls back to clearing just its own legacy column.
 *
 * `caller` tags the console.error on failure (mirrors each action's own log
 * prefix); the caller keeps its own i18n error key / audit event.
 */
export async function clearSeriesBinding(
  sb: AdminClient,
  clubId: string,
  column: "join_token" | "line_group_id",
  caller: string,
): Promise<{ ok: true } | { ok: false }> {
  const series = await getSeriesForClub(sb, clubId);
  if (series) {
    const { error: seriesErr } = await sb.from("club_series").update({ [column]: null }).eq("id", series.id);
    if (seriesErr) {
      console.error(`[${caller}] series`, seriesErr);
      return { ok: false };
    }
    const { error: legacyErr } = await sb.from("clubs").update({ [column]: null }).eq("series_id", series.id);
    if (legacyErr) {
      console.error(`[${caller}] legacy(series)`, legacyErr);
      return { ok: false };
    }
    return { ok: true };
  }

  const { error } = await sb.from("clubs").update({ [column]: null }).eq("id", clubId);
  if (error) {
    console.error(`[${caller}]`, error);
    return { ok: false };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Link-request idempotency (webhook self-link + join-link + manager pool)
// ---------------------------------------------------------------------------

/**
 * Whether a PENDING `club_link_requests` row already exists for
 * (seriesId, profileId) — series-scoped idempotency shared by every request
 * surface (a repeat visit/keyword after the active session pointer moves must
 * never double-request).
 *
 * `.limit(1)`, not `.maybeSingle()`: legacy backfilled rows can legitimately
 * hold multiple sessions' requests for one profile in the same series (see the
 * `20260715000400` migration note) — `.maybeSingle()` would error on >1 and
 * silently defeat this idempotency check.
 */
export async function hasPendingSeriesRequest(
  sb: AdminClient,
  seriesId: string,
  profileId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("club_link_requests")
    .select("id")
    .eq("series_id", seriesId)
    .eq("profile_id", profileId)
    .eq("status", "pending")
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Membership registry (decision #4/#11) — shared by every link surface
// ---------------------------------------------------------------------------

type UpsertSeriesMemberInput = {
  seriesId: string;
  profileId: string;
  name: string;
  /** Only overwrites default_level_id when provided (see brief §5 — "only when a level is provided"). */
  levelId?: string | null;
};

/**
 * Insert-or-update-in-place a `series_members` row for `profileId` in `seriesId`
 * (mirrors the partial UNIQUE(series_id, profile_id) WHERE profile_id IS NOT NULL).
 * Called by every successful link surface (manager pool link, known-profile link,
 * keyword self-link, join-link auto-link) so the registry always reflects the
 * latest confirmed identity — see decision #4 ("Trust") / #11 ("LINE-less members").
 * Returns the member row's id.
 *
 * Name-only member upgrade (decision #11 / task brief §5): if no row exists yet
 * for this profile but an EXISTING name-only member (`profile_id IS NULL`) has the
 * exact-unique `canonical_name`, that row is upgraded in place (set profile_id)
 * instead of inserting a duplicate — the manager-curated placeholder becomes the
 * real linked member. This reduces to the SAME exact+unique-among-unlinked rule
 * already extracted (and unit-tested) for the club_players keyword self-link flow
 * — `classifyRosterMatch` (`line-self-link.ts`) — mapped inline below
 * (`canonical_name` ~ `display_name`); this is the only call site for that mapping.
 */
export async function upsertSeriesMember(sb: AdminClient, input: UpsertSeriesMemberInput): Promise<string> {
  const { seriesId, profileId, name, levelId } = input;
  const now = new Date().toISOString();

  // Single read: every member row of this series — used both for the
  // already-a-member check below and the name-only-upgrade match, instead of
  // two separate queries.
  const { data: rows } = await sb
    .from("series_members")
    .select("id, canonical_name, profile_id")
    .eq("series_id", seriesId);
  const members = (rows ?? []) as { id: string; canonical_name: string; profile_id: string | null }[];

  // 1. Already a member of this series → update-in-place.
  const existing = members.find((m) => m.profile_id === profileId);
  if (existing) {
    const update: Record<string, unknown> = { canonical_name: name, last_linked_at: now };
    if (levelId) update.default_level_id = levelId;
    await sb.from("series_members").update(update).eq("id", existing.id);
    return existing.id;
  }

  // 2. Name-only member upgrade path (decision #11).
  const match = classifyRosterMatch(
    members.map((m) => ({ id: m.id, display_name: m.canonical_name, profile_id: m.profile_id })),
    name,
  );

  if (match.kind === "unique") {
    const update: Record<string, unknown> = { profile_id: profileId, canonical_name: name, last_linked_at: now };
    if (levelId) update.default_level_id = levelId;
    const { data: upgraded, error } = await sb
      .from("series_members")
      .update(update)
      .eq("id", match.playerId)
      .is("profile_id", null) // race guard: only upgrade if still name-only
      .select("id")
      .maybeSingle();
    if (!error && upgraded) return upgraded.id;
    // Lost the race (claimed concurrently) or write failed — fall through to insert.
  }

  // 3. Otherwise, a brand-new member row.
  const { data: created, error: insErr } = await sb
    .from("series_members")
    .insert({
      series_id: seriesId,
      profile_id: profileId,
      canonical_name: name,
      default_level_id: levelId ?? null,
    })
    .select("id")
    .single();
  if (insErr || !created) {
    throw new Error(`upsertSeriesMember: insert failed for series ${seriesId}: ${insErr?.message}`);
  }
  return created.id;
}
