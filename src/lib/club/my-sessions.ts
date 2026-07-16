/**
 * my-sessions.ts — PURE grouping for the "รอบตีของฉัน" list (grilled
 * 2026-07-16): every session the user MANAGES (owner / club co-admin / series
 * co-admin) plus every session they PARTICIPATE in (a `club_players` row links
 * their profile). Shared by `/clubs` (bottom section) and `/clubs/mine`, so the
 * two surfaces can never drift. Fetching lives in `my-sessions.server.ts`; this
 * module stays side-effect-free for unit tests.
 */

export type MySessionRow = {
  clubId: string;
  /** Canonical link target — null only for legacy rows with no series (the dispatcher redirects). */
  seriesId: string | null;
  sessionName: string;
  venue: string;
  play_date: string;
  start_time: string;
  end_time: string;
  joined: number;
  max: number;
  isActive: boolean;
  /** false = viewer-only participant row — gets the "เข้าร่วม" badge. */
  isManaged: boolean;
};

export type MySessionGroup = {
  key: string;
  /** null = the เฉพาะกิจ bucket (kept last); otherwise the series name. */
  seriesName: string | null;
  sessions: MySessionRow[];
};

export type MySessionSourceRow = {
  id: string;
  name: string;
  venue: string;
  play_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
  series_id: string | null;
  series: { id: string; name: string; is_adhoc: boolean; active_session_id: string | null } | null;
  managed: boolean;
  joined: number;
};

/**
 * Group per named ก๊วน; เฉพาะกิจ + legacy no-series rows pool into one trailing
 * bucket. Rows sort newest-first inside each group; groups sort by their newest
 * row. A session the user both manages and plays in counts as managed (no badge).
 */
export function buildMySessionGroups(rows: MySessionSourceRow[]): MySessionGroup[] {
  const toRow = (c: MySessionSourceRow): MySessionRow => ({
    clubId: c.id,
    seriesId: c.series_id,
    sessionName: c.name,
    venue: c.venue,
    play_date: c.play_date,
    start_time: c.start_time,
    end_time: c.end_time,
    joined: c.joined,
    max: c.max_players,
    isActive: c.series?.active_session_id === c.id,
    isManaged: c.managed,
  });

  const sorted = [...rows].sort((a, b) => b.play_date.localeCompare(a.play_date));
  const namedGroups = new Map<string, MySessionGroup>();
  const adhocRows: MySessionRow[] = [];
  for (const c of sorted) {
    if (c.series && !c.series.is_adhoc) {
      const g = namedGroups.get(c.series.id) ?? { key: c.series.id, seriesName: c.series.name, sessions: [] };
      g.sessions.push(toRow(c));
      namedGroups.set(c.series.id, g);
    } else {
      adhocRows.push(toRow(c));
    }
  }
  const groups: MySessionGroup[] = [...namedGroups.values()].sort((a, b) =>
    b.sessions[0].play_date.localeCompare(a.sessions[0].play_date),
  );
  if (adhocRows.length) groups.push({ key: "adhoc", seriesName: null, sessions: adhocRows });
  return groups;
}
