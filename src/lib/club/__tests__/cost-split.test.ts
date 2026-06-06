import { describe, it, expect } from "vitest";
import { computeClubSplit, type SplitInput } from "@/lib/club/cost-split";

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
    shuttleFee: 300,
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
    const r = byId(computeClubSplit(base({ shuttleFee: 0 })));
    expect(r.A.court).toBe(240);
    expect(r.B.court).toBe(240);
    expect(r.C.court).toBe(240);
    expect(r.A.court + r.B.court + r.C.court).toBe(720);
  });

  it("by_time: segment split → A 200, B 200, C 320 (spec example)", () => {
    const r = byId(computeClubSplit(base({ courtSplit: "by_time", shuttleFee: 0 })));
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
          shuttleFee: 0,
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
          shuttleFee: 0,
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
      computeClubSplit(base({ players, courtSplit: "by_time", courtFee: 180, shuttleFee: 0 })),
    );
    expect(r.A.court).toBe(90); // 60 own + 30 half-gap
    expect(r.B.court).toBe(90);
    expect(r.A.court + r.B.court).toBe(180);
  });

  it("ignore: gap segment is not collected (under-collects)", () => {
    const r = byId(
      computeClubSplit(
        base({ players, courtSplit: "by_time", courtFee: 180, shuttleFee: 0, gapPolicy: "ignore" }),
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
          shuttleFee: 0,
          gapPolicy: "owner",
          ownerId: "A",
        }),
      ),
    );
    expect(r.A.court).toBe(120); // 60 own + 60 gap
    expect(r.B.court).toBe(60);
  });
});

describe("computeClubSplit — shuttle", () => {
  it("even: 300 / 3 = 100 each", () => {
    const r = byId(computeClubSplit(base({ courtFee: 0 })));
    expect(r.A.shuttle).toBe(100);
    expect(r.B.shuttle).toBe(100);
    expect(r.C.shuttle).toBe(100);
  });

  it("by_games: 300 × games / 33 → 73 / 91 / 136 (sums to 300)", () => {
    const r = byId(computeClubSplit(base({ courtFee: 0, shuttleSplit: "by_games" })));
    expect(r.A.shuttle).toBe(73);
    expect(r.B.shuttle).toBe(91);
    expect(r.C.shuttle).toBe(136);
    expect(r.A.shuttle + r.B.shuttle + r.C.shuttle).toBe(300);
  });

  it("by_games with zero total games falls back to even split", () => {
    const r = byId(
      computeClubSplit(
        base({
          courtFee: 0,
          shuttleSplit: "by_games",
          players: [
            { id: "A", start: "18:00", end: "21:00", games: 0 },
            { id: "B", start: "18:00", end: "21:00", games: 0 },
          ],
        }),
      ),
    );
    expect(r.A.shuttle).toBe(150);
    expect(r.B.shuttle).toBe(150);
  });
});

describe("computeClubSplit — combined + rounding", () => {
  it("court by_time + shuttle by_games totals reconcile to 1020", () => {
    const rows = computeClubSplit(base({ courtSplit: "by_time", shuttleSplit: "by_games" }));
    const r = byId(rows);
    expect(r.A.total).toBe(200 + 73);
    expect(r.B.total).toBe(200 + 91);
    expect(r.C.total).toBe(320 + 136);
    const grand = rows.reduce((s, x) => s + x.total, 0);
    expect(grand).toBe(720 + 300);
  });

  it("rounding remainder lands on the largest payer, bucket sum exact", () => {
    // courtFee 100 / 3 even = 33.33 each → rounds 33/33/33 = 99, remainder +1 → largest gets 34.
    const rows = computeClubSplit(base({ courtFee: 100, courtSplit: "even", shuttleFee: 0 }));
    const sum = rows.reduce((s, x) => s + x.court, 0);
    expect(sum).toBe(100);
    expect(rows.map((x) => x.court).sort((a, b) => a - b)).toEqual([33, 33, 34]);
  });

  it("returns one row per player, input order preserved", () => {
    const rows = computeClubSplit(base());
    expect(rows.map((r) => r.playerId)).toEqual(["A", "B", "C"]);
  });

  it("zero fees → all zeros", () => {
    const r = byId(computeClubSplit(base({ courtFee: 0, shuttleFee: 0 })));
    expect(r.A.total).toBe(0);
    expect(r.C.total).toBe(0);
  });
});
