import { describe, it, expect } from "vitest";
import {
  computeClubSplit,
  computeExpenseShares,
  sessionHourSlots,
  type SplitInput,
} from "@/lib/club/cost-split";

// Anchor fixture from spec.md worked example: session 18:00–21:00,
// A(18–20), B(19–21), C(18–21); court 720, shuttle 300; games 8/10/15.
const A = { id: "A", start: "18:00", end: "20:00", games: 8 };
const B = { id: "B", start: "19:00", end: "21:00", games: 10 };
const C = { id: "C", start: "18:00", end: "21:00", games: 15 };

function base(overrides: Partial<SplitInput> = {}): SplitInput {
  return {
    players: [A, B, C],
    courtFee: 720,
    courtSplit: "even",
    shuttleSplit: "even",
    sessionStart: "18:00",
    sessionEnd: "21:00",
    gapPolicy: "spread",
    ...overrides,
  };
}

const byId = (rows: ReturnType<typeof computeClubSplit>) =>
  Object.fromEntries(rows.map((r) => [r.playerId, r]));

describe("computeClubSplit — court", () => {
  it("even: 720 / 3 = 240 each", () => {
    const r = byId(computeClubSplit(base()));
    expect(r.A.court).toBe(240);
    expect(r.B.court).toBe(240);
    expect(r.C.court).toBe(240);
    expect(r.A.court + r.B.court + r.C.court).toBe(720);
  });

  it("by_time: segment split → A 200, B 200, C 320 (spec example)", () => {
    const r = byId(computeClubSplit(base({ courtSplit: "by_time" })));
    expect(r.A.court).toBe(200);
    expect(r.B.court).toBe(200);
    expect(r.C.court).toBe(320);
    expect(r.A.court + r.B.court + r.C.court).toBe(720);
  });

  it("by_time clamps a player window that exceeds the session", () => {
    // A leaves "22:00" but session ends 21:00 → clamped, same as staying full.
    const r = byId(
      computeClubSplit(
        base({
          courtSplit: "by_time",
          players: [{ id: "A", start: "17:00", end: "22:00", games: 1 }],
        }),
      ),
    );
    expect(r.A.court).toBe(720); // single player pays the whole court
  });

  it("single player pays the full court (by_time, gap spread to self)", () => {
    const r = byId(
      computeClubSplit(
        base({
          courtSplit: "by_time",
          courtFee: 180,
          players: [{ id: "A", start: "18:00", end: "19:00", games: 1 }],
        }),
      ),
    );
    expect(r.A.court).toBe(180);
  });
});

describe("computeClubSplit — court by_time cross-midnight", () => {
  // Session 21:00 → 01:00 (crosses midnight, 4h window). courtFee 480 → 2 baht/min.
  function night(overrides: Partial<SplitInput> = {}): SplitInput {
    return {
      players: [],
      courtFee: 480,
      courtSplit: "by_time",
      shuttleSplit: "even",
      sessionStart: "21:00",
      sessionEnd: "01:00",
      gapPolicy: "spread",
      ...overrides,
    };
  }

  it("does not drop the court fee (regression: end < start → negative sessionMin)", () => {
    const r = byId(
      computeClubSplit(
        night({
          players: [
            { id: "A", start: "21:00", end: "01:00", games: 1 },
            { id: "B", start: "21:00", end: "01:00", games: 1 },
          ],
        }),
      ),
    );
    expect(r.A.court).toBe(240);
    expect(r.B.court).toBe(240);
    expect(r.A.court + r.B.court).toBe(480); // whole fee collected, not 0
  });

  it("segments by presence across midnight", () => {
    // A 21–23 (before midnight), B 23–01 (across midnight) → each pays their 2h half.
    const r = byId(
      computeClubSplit(
        night({
          players: [
            { id: "A", start: "21:00", end: "23:00", games: 1 },
            { id: "B", start: "23:00", end: "01:00", games: 1 },
          ],
        }),
      ),
    );
    expect(r.A.court).toBe(240);
    expect(r.B.court).toBe(240);
  });

  it("single player across midnight pays the whole court", () => {
    const r = byId(
      computeClubSplit(night({ players: [{ id: "A", start: "21:00", end: "01:00", games: 1 }] })),
    );
    expect(r.A.court).toBe(480);
  });

  it("clamps a window that overstays past the cross-midnight end", () => {
    // A leaves 02:00 but session ends 01:00 → clamped to the full session.
    const r = byId(
      computeClubSplit(night({ players: [{ id: "A", start: "21:00", end: "02:00", games: 1 }] })),
    );
    expect(r.A.court).toBe(480);
  });

  it("overlapping windows across midnight split the shared segment", () => {
    // A 21–00:00, B 22:00–01:00. 21–22 A-only, 22–00 shared, 00–01 B-only.
    const r = byId(
      computeClubSplit(
        night({
          players: [
            { id: "A", start: "21:00", end: "00:00", games: 1 },
            { id: "B", start: "22:00", end: "01:00", games: 1 },
          ],
        }),
      ),
    );
    expect(r.A.court).toBe(240); // 60min solo + half of 120min shared
    expect(r.B.court).toBe(240);
    expect(r.A.court + r.B.court).toBe(480);
  });

  it("start === end stays a zero-length window (no court fee), not a full 24h", () => {
    const r = byId(
      computeClubSplit(
        night({
          sessionStart: "21:00",
          sessionEnd: "21:00",
          players: [{ id: "A", start: "21:00", end: "21:00", games: 1 }],
        }),
      ),
    );
    expect(r.A.court).toBe(0);
  });
});

describe("computeClubSplit — court gap policy", () => {
  // session 18–21, A(18–19), B(20–21); 19–20 is a gap. court 180.
  const players = [
    { id: "A", start: "18:00", end: "19:00", games: 1 },
    { id: "B", start: "20:00", end: "21:00", games: 1 },
  ];

  it("spread: gap segment shared across all players", () => {
    const r = byId(
      computeClubSplit(base({ players, courtSplit: "by_time", courtFee: 180 })),
    );
    expect(r.A.court).toBe(90); // 60 own + 30 half-gap
    expect(r.B.court).toBe(90);
    expect(r.A.court + r.B.court).toBe(180);
  });

  it("spread: a player whose window is entirely outside the session pays no gap share (P2 #10)", () => {
    const r = byId(
      computeClubSplit(
        base({
          players: [
            ...players,
            { id: "C", start: "22:00", end: "23:00", games: 1 }, // entirely after the 18–21 session
          ],
          courtSplit: "by_time",
          courtFee: 180,
        }),
      ),
    );
    expect(r.A.court).toBe(90); // gap shared only across present players (A, B)
    expect(r.B.court).toBe(90);
    expect(r.C.court).toBe(0); // never present → excluded from the gap denominator
  });

  it("ignore: gap segment is not collected (under-collects)", () => {
    const r = byId(
      computeClubSplit(
        base({ players, courtSplit: "by_time", courtFee: 180, gapPolicy: "ignore" }),
      ),
    );
    expect(r.A.court).toBe(60);
    expect(r.B.court).toBe(60);
    expect(r.A.court + r.B.court).toBe(120); // 60 of court fee unclaimed
  });

  it("owner: gap segment charged to the owner", () => {
    const r = byId(
      computeClubSplit(
        base({
          players,
          courtSplit: "by_time",
          courtFee: 180,
          gapPolicy: "owner",
          ownerId: "A",
        }),
      ),
    );
    expect(r.A.court).toBe(120); // 60 own + 60 gap
    expect(r.B.court).toBe(60);
  });
});

describe("computeClubSplit — shuttle even (per-shuttle price)", () => {
  it("Σ shuttles × price ÷ N — equal for everyone, regardless of who played", () => {
    // total 3 shuttles × 20 = 60, ÷ 3 players = 20 each.
    const r = byId(
      computeClubSplit(
        base({
          courtFee: 0,
          shuttleSplit: "even",
          shuttlePrice: 20,
          matches: [
            { playerIds: ["A", "B"], shuttles: 1 },
            { playerIds: ["A", "C"], shuttles: 2 },
          ],
        }),
      ),
    );
    expect([r.A.shuttle, r.B.shuttle, r.C.shuttle]).toEqual([20, 20, 20]);
    expect(r.A.shuttle + r.B.shuttle + r.C.shuttle).toBe(60);
  });

  it("no matches → 0 (shuttle cost needs the rotation queue)", () => {
    const r = byId(
      computeClubSplit(base({ courtFee: 0, shuttleSplit: "even", shuttlePrice: 20, matches: [] })),
    );
    expect(r.A.shuttle).toBe(0);
  });

  it("price 0 → 0", () => {
    const r = byId(
      computeClubSplit(
        base({
          courtFee: 0,
          shuttleSplit: "even",
          shuttlePrice: 0,
          matches: [{ playerIds: ["A", "B", "C"], shuttles: 5 }],
        }),
      ),
    );
    expect(r.A.shuttle).toBe(0);
  });

  it("ceils each share up to a whole baht (over-collects, equal figures)", () => {
    // 1 shuttle × 20 = 20 ÷ 3 = 6.67 each → ceil 7 each → sum 21 (over-collects by 1).
    const rows = computeClubSplit(
      base({
        courtFee: 0,
        shuttleSplit: "even",
        shuttlePrice: 20,
        matches: [{ playerIds: ["A"], shuttles: 1 }],
      }),
    );
    expect(rows.map((r) => r.shuttle)).toEqual([7, 7, 7]);
    expect(rows.reduce((s, r) => s + r.shuttle, 0)).toBe(21);
  });

  it("manual shuttleTotal (> 0) overrides the match-derived count", () => {
    // override 30 shuttles × 10 = 300 ÷ 3 = 100 each — ignores the 3 played shuttles.
    const r = byId(
      computeClubSplit(
        base({
          courtFee: 0,
          shuttleSplit: "even",
          shuttlePrice: 10,
          shuttleTotal: 30,
          matches: [{ playerIds: ["A", "B"], shuttles: 3 }],
        }),
      ),
    );
    expect([r.A.shuttle, r.B.shuttle, r.C.shuttle]).toEqual([100, 100, 100]);
  });

  it("shuttleTotal 0 falls back to the match-derived count (0 = not set)", () => {
    // Σ matches (3) × 20 ÷ 3 = 20 each — the explicit 0 does not zero the bill.
    const r = byId(
      computeClubSplit(
        base({
          courtFee: 0,
          shuttleSplit: "even",
          shuttlePrice: 20,
          shuttleTotal: 0,
          matches: [{ playerIds: ["A", "B", "C"], shuttles: 3 }],
        }),
      ),
    );
    expect([r.A.shuttle, r.B.shuttle, r.C.shuttle]).toEqual([20, 20, 20]);
  });

  it("manual shuttleTotal bills shuttles with NO matches (no rotation queue used)", () => {
    // 30 × 10 ÷ 3 = 100 each even though no match was recorded.
    const r = byId(
      computeClubSplit(
        base({ courtFee: 0, shuttleSplit: "even", shuttlePrice: 10, shuttleTotal: 30, matches: [] }),
      ),
    );
    expect([r.A.shuttle, r.B.shuttle, r.C.shuttle]).toEqual([100, 100, 100]);
  });

  it("manual shuttleTotal with price 0 → 0 (count needs a price)", () => {
    const r = byId(
      computeClubSplit(
        base({ courtFee: 0, shuttleSplit: "even", shuttlePrice: 0, shuttleTotal: 40, matches: [] }),
      ),
    );
    expect(r.A.shuttle).toBe(0);
  });
});

describe("computeClubSplit — combined + rounding", () => {
  it("court by_time + shuttle per_match totals reconcile", () => {
    // court by_time → A 200, B 200, C 320 (720). shuttle per_match: one match
    // {A,B,C} × 3 shuttles × 20 = 60 total ÷ 3 players = 20 each.
    const rows = computeClubSplit(
      base({
        courtSplit: "by_time",
        shuttleSplit: "per_match",
        shuttlePrice: 20,
        matches: [{ playerIds: ["A", "B", "C"], shuttles: 3 }],
      }),
    );
    const r = byId(rows);
    expect(r.A.total).toBe(200 + 20);
    expect(r.B.total).toBe(200 + 20);
    expect(r.C.total).toBe(320 + 20);
    expect(rows.reduce((s, x) => s + x.total, 0)).toBe(720 + 60);
  });

  it("ceils every share up — equal players get equal figures (over-collects)", () => {
    // courtFee 100 / 3 even = 33.33 each → ceil 34 each = 102 (over-collects by 2); no single payer spikes.
    const rows = computeClubSplit(base({ courtFee: 100, courtSplit: "even" }));
    const sum = rows.reduce((s, x) => s + x.court, 0);
    expect(rows.map((x) => x.court)).toEqual([34, 34, 34]);
    expect(sum).toBe(102);
  });

  it("returns one row per player, input order preserved", () => {
    const rows = computeClubSplit(base());
    expect(rows.map((r) => r.playerId)).toEqual(["A", "B", "C"]);
  });

  it("zero fees → all zeros", () => {
    const r = byId(computeClubSplit(base({ courtFee: 0 })));
    expect(r.A.total).toBe(0);
    expect(r.C.total).toBe(0);
  });
});

describe("computeClubSplit — shuttle per_match", () => {
  const players4 = [
    { id: "A", start: "18:00", end: "21:00", games: 0 },
    { id: "B", start: "18:00", end: "21:00", games: 0 },
    { id: "C", start: "18:00", end: "21:00", games: 0 },
    { id: "D", start: "18:00", end: "21:00", games: 0 },
  ];
  function pm(overrides: Partial<SplitInput> = {}): SplitInput {
    return {
      players: players4,
      courtFee: 0,
      courtSplit: "even",
        shuttleSplit: "per_match",
      shuttlePrice: 80,
      sessionStart: "18:00",
      sessionEnd: "21:00",
      matches: [{ playerIds: ["A", "B", "C", "D"], shuttles: 1 }],
      ...overrides,
    };
  }

  it("1 shuttle ÷ 4 players: 80/4 = 20 each", () => {
    const r = byId(computeClubSplit(pm()));
    expect([r.A.shuttle, r.B.shuttle, r.C.shuttle, r.D.shuttle]).toEqual([20, 20, 20, 20]);
  });

  it("shuttles_used scales the cost", () => {
    const r = byId(computeClubSplit(pm({ matches: [{ playerIds: ["A", "B", "C", "D"], shuttles: 2 }] })));
    expect(r.A.shuttle).toBe(40); // 2*80/4
  });

  it("accumulates across matches a player joined", () => {
    const r = byId(computeClubSplit(pm({
      matches: [
        { playerIds: ["A", "B", "C", "D"], shuttles: 1 }, // 20 each
        { playerIds: ["A", "B"], shuttles: 1 },             // A,B +40 each (80/2)
      ],
    })));
    expect(r.A.shuttle).toBe(60); // 20 + 40
    expect(r.C.shuttle).toBe(20); // only first match
  });

  it("price 0 → no shuttle cost", () => {
    const r = byId(computeClubSplit(pm({ shuttlePrice: 0 })));
    expect(r.A.shuttle).toBe(0);
  });

  it("no matches → no shuttle cost", () => {
    const r = byId(computeClubSplit(pm({ matches: [] })));
    expect(r.A.shuttle).toBe(0);
  });

  it("ceils each share up to a whole baht (price 70 ÷ 4 → 18 each)", () => {
    const rows = computeClubSplit(pm({ shuttlePrice: 70 }));
    expect(rows.map((r) => r.shuttle)).toEqual([18, 18, 18, 18]);
    // 17.5 each → ceil 18 each → 72 (over-collects by 2)
    expect(rows.reduce((s, r) => s + r.shuttle, 0)).toBe(72);
  });

  it("drops the share of a player not in the roster (under-collect)", () => {
    const matches = [{ playerIds: ["A", "B", "C", "X"], shuttles: 1 }]; // X removed
    const r = byId(computeClubSplit(pm({ matches })));
    expect([r.A.shuttle, r.B.shuttle, r.C.shuttle, r.D.shuttle]).toEqual([20, 20, 20, 0]);
    const sum = computeClubSplit(pm({ matches })).reduce((s, x) => s + x.shuttle, 0);
    expect(sum).toBe(60); // X's 20 dropped
  });
});

describe("computeClubSplit — shuttle per_player (full, no division)", () => {
  const players4 = [
    { id: "A", start: "18:00", end: "21:00", games: 0 },
    { id: "B", start: "18:00", end: "21:00", games: 0 },
    { id: "C", start: "18:00", end: "21:00", games: 0 },
    { id: "D", start: "18:00", end: "21:00", games: 0 },
  ];
  function pp(overrides: Partial<SplitInput> = {}): SplitInput {
    return {
      players: players4,
      courtFee: 0,
      courtSplit: "even",
        shuttleSplit: "per_player",
      shuttlePrice: 20,
      sessionStart: "18:00",
      sessionEnd: "21:00",
      matches: [{ playerIds: ["A", "B", "C", "D"], shuttles: 1 }],
      ...overrides,
    };
  }

  it("each player in the match pays the FULL shuttles × price (no ÷4)", () => {
    const r = byId(computeClubSplit(pp()));
    expect([r.A.shuttle, r.B.shuttle, r.C.shuttle, r.D.shuttle]).toEqual([20, 20, 20, 20]);
  });

  it("shuttles scale per player (2 shuttles = 40 each)", () => {
    const r = byId(computeClubSplit(pp({ matches: [{ playerIds: ["A", "B", "C", "D"], shuttles: 2 }] })));
    expect(r.A.shuttle).toBe(40);
  });

  it("accumulates the full cost across matches a player joined", () => {
    const r = byId(
      computeClubSplit(
        pp({
          matches: [
            { playerIds: ["A", "B", "C", "D"], shuttles: 1 }, // +20 each
            { playerIds: ["A", "B"], shuttles: 1 },             // A,B +20 each
          ],
        }),
      ),
    );
    expect(r.A.shuttle).toBe(40); // 20 + 20
    expect(r.C.shuttle).toBe(20); // first match only
  });

  it("no matches → 0", () => {
    const r = byId(computeClubSplit(pp({ matches: [] })));
    expect(r.A.shuttle).toBe(0);
  });
});

describe("computeClubSplit — shuttle by_time (per-hour count)", () => {
  // Session 18:00–20:00 (two 1-hour slots). A plays both hours; B only hour 1;
  // C only hour 2. The headline fairness case the feature was built for.
  const A2 = { id: "A", start: "18:00", end: "20:00", games: 0 };
  const B1 = { id: "B", start: "18:00", end: "19:00", games: 0 };
  const C1 = { id: "C", start: "19:00", end: "20:00", games: 0 };
  function bt(overrides: Partial<SplitInput> = {}): SplitInput {
    return {
      players: [A2, B1, C1],
      courtFee: 0,
      courtSplit: "even",
      shuttleSplit: "by_time",
      shuttlePrice: 10,
      sessionStart: "18:00",
      sessionEnd: "20:00",
      shuttleHourly: [6, 6], // 6 shuttles hour 1, 6 hour 2 (12 total × ฿10 = ฿120)
      ...overrides,
    };
  }

  it("splits each hour among only the players present that whole hour", () => {
    const r = byId(computeClubSplit(bt()));
    // hour 1 (฿60) ÷ {A,B} = 30; hour 2 (฿60) ÷ {A,C} = 30
    expect(r.A.shuttle).toBe(60); // both hours
    expect(r.B.shuttle).toBe(30); // hour 1 only — NOT charged for hour 2
    expect(r.C.shuttle).toBe(30); // hour 2 only — NOT charged for hour 1
    // whole bill collected, nothing lost
    expect(r.A.shuttle + r.B.shuttle + r.C.shuttle).toBe(120);
  });

  it("unequal per-hour counts allocate independently", () => {
    const r = byId(computeClubSplit(bt({ shuttleHourly: [8, 4] })));
    expect(r.A.shuttle).toBe(60); // 80/2 + 40/2 = 40 + 20
    expect(r.B.shuttle).toBe(40); // hour 1 only: 80/2
    expect(r.C.shuttle).toBe(20); // hour 2 only: 40/2
  });

  it("price 0 → no shuttle cost", () => {
    const r = byId(computeClubSplit(bt({ shuttlePrice: 0 })));
    expect([r.A.shuttle, r.B.shuttle, r.C.shuttle]).toEqual([0, 0, 0]);
  });

  it("empty / missing per-hour counts → 0", () => {
    expect(byId(computeClubSplit(bt({ shuttleHourly: [] }))).A.shuttle).toBe(0);
    expect(byId(computeClubSplit(bt({ shuttleHourly: undefined }))).A.shuttle).toBe(0);
  });

  it("a slot with 0 shuttles is skipped (only the funded hour is charged)", () => {
    const r = byId(computeClubSplit(bt({ shuttleHourly: [6, 0] })));
    expect(r.A.shuttle).toBe(30); // hour 1 only
    expect(r.B.shuttle).toBe(30);
    expect(r.C.shuttle).toBe(0); // hour 2 had no shuttles
  });

  it("ceils each share up to a whole baht", () => {
    // hour 1: 5 shuttles × ฿10 = ฿50 ÷ {A,B} = 25; hour 2: 0
    const r = byId(computeClubSplit(bt({ shuttleHourly: [5, 0] })));
    expect(r.A.shuttle).toBe(25);
    // 50 ÷ 2 = 25 exact; use a 3-payer odd split for the ceil check
    const r2 = byId(
      computeClubSplit(
        bt({
          players: [A2, { id: "B", start: "18:00", end: "20:00", games: 0 }, { id: "C", start: "18:00", end: "20:00", games: 0 }],
          shuttleHourly: [5, 0],
        }),
      ),
    );
    // ฿50 ÷ 3 = 16.67 → ceil 17 each
    expect([r2.A.shuttle, r2.B.shuttle, r2.C.shuttle]).toEqual([17, 17, 17]);
  });

  it("funded hour with nobody present falls back to all attendees (no lost cost)", () => {
    // Everyone arrives 18:30, so nobody covers the full 18:00–19:00 slot.
    const late = [
      { id: "A", start: "18:30", end: "20:00", games: 0 },
      { id: "B", start: "18:30", end: "20:00", games: 0 },
    ];
    const r = byId(computeClubSplit(bt({ players: late, shuttleHourly: [6, 6] })));
    // hour 1 (฿60) → fallback ÷ {A,B} = 30 each; hour 2 (฿60) ÷ {A,B} = 30 each
    expect(r.A.shuttle).toBe(60);
    expect(r.B.shuttle).toBe(60);
    expect(r.A.shuttle + r.B.shuttle).toBe(120); // nothing lost
  });

  it("counts beyond the slot count are ignored; a partial last hour still counts", () => {
    // 18:00–19:30 → slots [18:00–19:00, 19:00–19:30]; a 3rd count is ignored.
    const r = byId(
      computeClubSplit(
        bt({
          players: [{ id: "A", start: "18:00", end: "19:30", games: 0 }],
          sessionEnd: "19:30",
          shuttleHourly: [6, 6, 99],
        }),
      ),
    );
    expect(r.A.shuttle).toBe(120); // (6+6) × 10, sole payer; the 99 is dropped
  });
});

describe("sessionHourSlots", () => {
  it("splits a whole-hour window into 1-hour slots", () => {
    expect(sessionHourSlots("18:00", "21:00")).toEqual([
      { start: 1080, end: 1140 },
      { start: 1140, end: 1200 },
      { start: 1200, end: 1260 },
    ]);
  });

  it("keeps a short final slot for a non-whole-hour window", () => {
    expect(sessionHourSlots("18:00", "19:30")).toEqual([
      { start: 1080, end: 1140 },
      { start: 1140, end: 1170 },
    ]);
  });

  it("handles a cross-midnight window (end shifted +1440)", () => {
    expect(sessionHourSlots("21:00", "01:00")).toEqual([
      { start: 1260, end: 1320 },
      { start: 1320, end: 1380 },
      { start: 1380, end: 1440 },
      { start: 1440, end: 1500 },
    ]);
  });

  it("zero-length window → no slots", () => {
    expect(sessionHourSlots("18:00", "18:00")).toEqual([]);
  });
});

describe("computeExpenseShares (personal expense rollup)", () => {
  const ids = (m: Map<string, number>) => Object.fromEntries(m);

  it("no designated payers → split ceil among all", () => {
    const r = ids(computeExpenseShares(["A", "B", "C"], [{ amount: 300, payerPlayerIds: [] }]));
    expect([r.A, r.B, r.C]).toEqual([100, 100, 100]);
  });

  it("designated payers only", () => {
    const r = ids(computeExpenseShares(["A", "B", "C"], [{ amount: 100, payerPlayerIds: ["A"] }]));
    expect([r.A, r.B, r.C]).toEqual([100, 0, 0]);
  });

  it("ceil per head among designated", () => {
    const r = ids(computeExpenseShares(["A", "B", "C"], [{ amount: 90, payerPlayerIds: ["A", "B"] }]));
    expect([r.A, r.B, r.C]).toEqual([45, 45, 0]);
  });

  it("accumulates across expenses", () => {
    const r = ids(
      computeExpenseShares(["A", "B", "C"], [
        { amount: 300, payerPlayerIds: [] },
        { amount: 100, payerPlayerIds: ["A"] },
      ]),
    );
    expect([r.A, r.B, r.C]).toEqual([200, 100, 100]);
  });

  it("skips zero amount + ignores unknown payer ids", () => {
    const r = ids(
      computeExpenseShares(["A", "B"], [
        { amount: 0, payerPlayerIds: [] },
        { amount: 50, payerPlayerIds: ["A", "X"] }, // X not a player → split among A only
      ]),
    );
    expect([r.A, r.B]).toEqual([50, 0]);
  });
});
