import { describe, it, expect } from "vitest";
import { isSessionDone } from "../session-done";

const TODAY = "2026-07-16";

describe("isSessionDone (ปิดรอบ)", () => {
  it("closed_at set → done, regardless of date", () => {
    expect(isSessionDone({ play_date: "2026-07-16", closed_at: "2026-07-16T10:00:00Z" }, TODAY)).toBe(true);
    expect(isSessionDone({ play_date: "2026-07-20", closed_at: "2026-07-16T10:00:00Z" }, TODAY)).toBe(true);
  });

  it("play_date past → done automatically (no closed_at write)", () => {
    expect(isSessionDone({ play_date: "2026-07-15", closed_at: null }, TODAY)).toBe(true);
  });

  it("today / future + not closed → live", () => {
    expect(isSessionDone({ play_date: "2026-07-16", closed_at: null }, TODAY)).toBe(false);
    expect(isSessionDone({ play_date: "2026-07-20", closed_at: null }, TODAY)).toBe(false);
  });
});
