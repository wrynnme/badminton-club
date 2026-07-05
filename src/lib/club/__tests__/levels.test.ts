import { describe, expect, it } from "vitest";
import { resolveActiveLevelIds } from "../levels";

const g1 = { id: "g1", club_id: null };
const g2 = { id: "g2", club_id: null };
const c1 = { id: "c1", club_id: "club-a" };
const c2 = { id: "c2", club_id: "club-a" };

describe("resolveActiveLevelIds", () => {
  it("club-customized: only club rows are active, global rows excluded", () => {
    const ids = resolveActiveLevelIds([g1, g2, c1, c2]);
    expect(ids).toEqual(new Set(["c1", "c2"]));
    expect(ids.has("g1")).toBe(false);
  });

  it("global-only (not customized): global rows are the active set", () => {
    const ids = resolveActiveLevelIds([g1, g2]);
    expect(ids).toEqual(new Set(["g1", "g2"]));
  });

  it("empty input → empty set", () => {
    expect(resolveActiveLevelIds([]).size).toBe(0);
  });

  it("membership check rejects a foreign id", () => {
    const ids = resolveActiveLevelIds([g1, c1]);
    expect(ids.has("c1")).toBe(true);
    expect(ids.has("other-club-level")).toBe(false);
    // global row shadowed by the club's own set
    expect(ids.has("g1")).toBe(false);
  });
});
