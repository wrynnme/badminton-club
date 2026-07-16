import { describe, it, expect } from "vitest";
import { buildMySessionGroups, type MySessionSourceRow } from "../my-sessions";

const SERIES_A = { id: "sA", name: "MUGGLE", is_adhoc: false, active_session_id: "c2" };
const SERIES_B = { id: "sB", name: "แป้งบี", is_adhoc: false, active_session_id: null };
const ADHOC = { id: "sX", name: "one-off", is_adhoc: true, active_session_id: "c9" };

let seq = 0;
const row = (over: Partial<MySessionSourceRow>): MySessionSourceRow => ({
  id: `c${++seq}`,
  name: "รอบตี",
  venue: "สนาม",
  play_date: "2026-07-10",
  start_time: "19:00:00",
  end_time: "22:00:00",
  max_players: 12,
  series_id: over.series?.id ?? null,
  series: null,
  managed: true,
  joined: 0,
  ...over,
});

describe("buildMySessionGroups", () => {
  it("groups by named series, adhoc + no-series bucket last", () => {
    const groups = buildMySessionGroups([
      row({ series: SERIES_A, play_date: "2026-07-10" }),
      row({ series: ADHOC, play_date: "2026-07-16" }),
      row({ series: null, play_date: "2026-07-15" }), // legacy no-series
      row({ series: SERIES_B, play_date: "2026-07-12" }),
    ]);
    expect(groups.map((g) => g.seriesName)).toEqual(["แป้งบี", "MUGGLE", null]);
    expect(groups[2].sessions).toHaveLength(2); // adhoc + legacy pooled
  });

  it("sorts groups by their newest session and rows newest-first", () => {
    const groups = buildMySessionGroups([
      row({ series: SERIES_A, play_date: "2026-07-01" }),
      row({ series: SERIES_A, play_date: "2026-07-16" }),
      row({ series: SERIES_B, play_date: "2026-07-10" }),
    ]);
    expect(groups[0].seriesName).toBe("MUGGLE");
    expect(groups[0].sessions.map((s) => s.play_date)).toEqual(["2026-07-16", "2026-07-01"]);
  });

  it("marks the active session and carries isManaged through", () => {
    const groups = buildMySessionGroups([
      row({ id: "c2", series: SERIES_A, managed: false }),
      row({ id: "c3", series: SERIES_A, managed: true }),
    ]);
    const byId = new Map(groups[0].sessions.map((s) => [s.clubId, s]));
    expect(byId.get("c2")).toMatchObject({ isActive: true, isManaged: false });
    expect(byId.get("c3")).toMatchObject({ isActive: false, isManaged: true });
  });

  it("returns [] for no rows", () => {
    expect(buildMySessionGroups([])).toEqual([]);
  });
});
