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
  closed_at: null,
  ...over,
});

// Fixed "today" for the pure builder — rows above default to 2026-07-10..16.
const TODAY = "2026-07-16";

describe("buildMySessionGroups", () => {
  it("groups by named series, adhoc + no-series bucket last", () => {
    const groups = buildMySessionGroups([
      row({ series: SERIES_A, play_date: "2026-07-10" }),
      row({ series: ADHOC, play_date: "2026-07-16" }),
      row({ series: null, play_date: "2026-07-15" }), // legacy no-series
      row({ series: SERIES_B, play_date: "2026-07-12" }),
    ], TODAY);
    expect(groups.map((g) => g.seriesName)).toEqual(["แป้งบี", "MUGGLE", null]);
    expect(groups[2].sessions).toHaveLength(2); // adhoc + legacy pooled
  });

  it("sorts groups by their newest session and rows newest-first", () => {
    const groups = buildMySessionGroups([
      row({ series: SERIES_A, play_date: "2026-07-01" }),
      row({ series: SERIES_A, play_date: "2026-07-16" }),
      row({ series: SERIES_B, play_date: "2026-07-10" }),
    ], TODAY);
    expect(groups[0].seriesName).toBe("MUGGLE");
    expect(groups[0].sessions.map((s) => s.play_date)).toEqual(["2026-07-16", "2026-07-01"]);
  });

  it("marks the active session and carries isManaged through", () => {
    const groups = buildMySessionGroups([
      row({ id: "c2", series: SERIES_A, managed: false, play_date: "2026-07-16" }),
      row({ id: "c3", series: SERIES_A, managed: true, play_date: "2026-07-16" }),
    ], TODAY);
    const byId = new Map(groups[0].sessions.map((s) => [s.clubId, s]));
    expect(byId.get("c2")).toMatchObject({ isActive: true, isManaged: false, isDone: false });
    expect(byId.get("c3")).toMatchObject({ isActive: false, isManaged: true, isDone: false });
  });

  it("marks done rows: closed_at set OR play_date past (ปิดรอบ)", () => {
    const groups = buildMySessionGroups([
      row({ id: "cPast", series: SERIES_A, play_date: "2026-07-10" }),
      row({ id: "cClosed", series: SERIES_A, play_date: "2026-07-16", closed_at: "2026-07-16T12:00:00Z" }),
      row({ id: "cLive", series: SERIES_A, play_date: "2026-07-16" }),
      row({ id: "cFuture", series: SERIES_A, play_date: "2026-07-20" }),
    ], TODAY);
    const byId = new Map(groups[0].sessions.map((s) => [s.clubId, s]));
    expect(byId.get("cPast")?.isDone).toBe(true);
    expect(byId.get("cClosed")?.isDone).toBe(true);
    expect(byId.get("cLive")?.isDone).toBe(false);
    expect(byId.get("cFuture")?.isDone).toBe(false);
  });

  it("returns [] for no rows", () => {
    expect(buildMySessionGroups([], TODAY)).toEqual([]);
  });
});
