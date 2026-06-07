import { describe, it, expect } from "vitest";
import { computeClubSplit, computeExpenseShares, type SplitInput } from "@/lib/club/cost-split";

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

  it("rounds to whole baht preserving the collected total", () => {
    // 1 shuttle × 20 = 20 ÷ 3 = 6.67 each → rounds, remainder on largest, sum 20.
    const sum = computeClubSplit(
      base({
        courtFee: 0,
        shuttleSplit: "even",
        shuttlePrice: 20,
        matches: [{ playerIds: ["A"], shuttles: 1 }],
      }),
    ).reduce((s, r) => s + r.shuttle, 0);
    expect(sum).toBe(20);
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

  it("rounding remainder lands on the largest payer, bucket sum exact", () => {
    // courtFee 100 / 3 even = 33.33 each → rounds 33/33/33 = 99, remainder +1 → largest gets 34.
    const rows = computeClubSplit(base({ courtFee: 100, courtSplit: "even" }));
    const sum = rows.reduce((s, x) => s + x.court, 0);
    expect(sum).toBe(100);
    expect(rows.map((x) => x.court).sort((a, b) => a - b)).toEqual([33, 33, 34]);
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

  it("rounds to whole baht preserving collected total (price 70 ÷ 4)", () => {
    const sum = computeClubSplit(pm({ shuttlePrice: 70 })).reduce((s, r) => s + r.shuttle, 0);
    expect(sum).toBe(70); // 17.5 each → rounds, remainder dumped on largest
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
