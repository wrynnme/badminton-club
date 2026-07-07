import { describe, it, expect } from "vitest";
import {
  emptyPairHistory,
  clonePairHistory,
  pairKey,
  recordPairing,
  recordSidePartner,
  pairingCost,
  partnerCost,
  partnerPairCost,
} from "../pair-history";

const side = (p1: string, p2: string | null = null) => ({ player1: p1, player2: p2 });

describe("pairKey", () => {
  it("is order-independent", () => {
    expect(pairKey("A", "B")).toBe(pairKey("B", "A"));
    expect(pairKey("A", "B")).toBe("A|B");
  });
});

describe("recordPairing + costs", () => {
  it("counts same-side as partners and cross-side as opponents", () => {
    const h = emptyPairHistory();
    recordPairing(h, side("A", "B"), side("C", "D"));

    // partners
    expect(partnerPairCost(h, "A", "B")).toBe(1);
    expect(partnerPairCost(h, "C", "D")).toBe(1);
    expect(partnerPairCost(h, "A", "C")).toBe(0);
    // opponents (all cross pairs)
    expect(pairingCost(h, side("A", "C"), side("B", "D"))).toBe(
      // A-C were opponents once, B-D were opponents once, A partnered nobody here
      2,
    );
  });

  it("pairingCost sums partner-repeats + opponent-repeats equally", () => {
    const h = emptyPairHistory();
    recordPairing(h, side("A", "B"), side("C", "D")); // AB partner, CD partner, cross opps
    // Re-proposing the identical match: AB partner(1) + CD partner(1) + 4 opp pairs(1 each)
    expect(pairingCost(h, side("A", "B"), side("C", "D"))).toBe(1 + 1 + 4);
  });

  it("partnerCost is 0 for singles and reads the doubles partnership", () => {
    const h = emptyPairHistory();
    recordPairing(h, side("A", "B"), side("C", "D"));
    expect(partnerCost(h, side("A", "B"))).toBe(1);
    expect(partnerCost(h, side("A"))).toBe(0);
  });

  it("recordSidePartner bumps only that side's partnership, no opponents", () => {
    const h = emptyPairHistory();
    recordSidePartner(h, side("A", "B"));
    expect(partnerPairCost(h, "A", "B")).toBe(1);
    // nothing recorded as opponents
    expect(pairingCost(h, side("A"), side("C"))).toBe(0);
  });
});

describe("clonePairHistory", () => {
  it("is a deep-enough copy — mutating the clone leaves the source untouched", () => {
    const src = emptyPairHistory();
    recordPairing(src, side("A", "B"), side("C", "D"));
    const clone = clonePairHistory(src);
    recordPairing(clone, side("A", "B"), side("C", "D"));
    expect(partnerPairCost(clone, "A", "B")).toBe(2);
    expect(partnerPairCost(src, "A", "B")).toBe(1);
  });

  it("clone of undefined is an empty history", () => {
    const h = clonePairHistory(undefined);
    expect(h.partner.size).toBe(0);
    expect(h.opponent.size).toBe(0);
  });
});
