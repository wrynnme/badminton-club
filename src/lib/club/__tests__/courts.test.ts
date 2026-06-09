import { describe, it, expect } from "vitest";
import { firstFreeCourt, occupiedCourtMap } from "@/lib/club/courts";
import type { ClubMatch } from "@/lib/types";

// Minimal ClubMatch fixtures — only `status` + `court` matter to these helpers.
function m(status: ClubMatch["status"], court: string | null): ClubMatch {
  return { status, court } as ClubMatch;
}

describe("occupiedCourtMap", () => {
  it("maps only in_progress matches with a court", () => {
    const map = occupiedCourtMap([
      m("in_progress", "1"),
      m("pending", "2"), // not started → not occupying
      m("completed", "3"), // finished → not occupying
      m("in_progress", null), // no court assigned → skipped
    ]);
    expect([...map.keys()]).toEqual(["1"]);
  });

  it("is empty for no matches", () => {
    expect(occupiedCourtMap([]).size).toBe(0);
  });

  it('keeps court "0" (truthy string, not falsy)', () => {
    const map = occupiedCourtMap([m("in_progress", "0")]);
    expect(map.has("0")).toBe(true);
  });
});

describe("firstFreeCourt", () => {
  it("returns the first court with no in_progress match", () => {
    const courts = ["1", "2", "3"];
    const matches = [m("in_progress", "1")];
    expect(firstFreeCourt(courts, matches)).toBe("2");
  });

  it("falls back to courts[0] when every court is occupied", () => {
    const courts = ["1", "2"];
    const matches = [m("in_progress", "1"), m("in_progress", "2")];
    expect(firstFreeCourt(courts, matches)).toBe("1");
  });

  it('returns "" when there are no courts', () => {
    expect(firstFreeCourt([], [])).toBe("");
  });

  it("ignores pending/completed matches when picking a free court", () => {
    const courts = ["1", "2"];
    const matches = [m("pending", "1"), m("completed", "1")];
    expect(firstFreeCourt(courts, matches)).toBe("1");
  });
});
