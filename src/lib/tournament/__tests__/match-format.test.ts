import { describe, it, expect } from "vitest";
import {
  MATCH_FORMAT_BOUNDS,
  MATCH_FORMAT_LABEL_TH,
  maxGamesForFormat,
  isMatchComplete,
} from "../match-format";
import type { Game } from "@/lib/types";

const g = (a: number, b: number): Game => ({ a, b });

describe("maxGamesForFormat", () => {
  it("fixed_2 → 2, best_of_3 → 3, best_of_5 → 5", () => {
    expect(maxGamesForFormat("fixed_2")).toBe(2);
    expect(maxGamesForFormat("best_of_3")).toBe(3);
    expect(maxGamesForFormat("best_of_5")).toBe(5);
  });
});

describe("MATCH_FORMAT_BOUNDS / labels", () => {
  it("only fixed_2 allows a draw", () => {
    expect(MATCH_FORMAT_BOUNDS.fixed_2.canDraw).toBe(true);
    expect(MATCH_FORMAT_BOUNDS.best_of_3.canDraw).toBe(false);
    expect(MATCH_FORMAT_BOUNDS.best_of_5.canDraw).toBe(false);
  });
  it("winAt = ceil(maxGames/2) clinch", () => {
    expect(MATCH_FORMAT_BOUNDS.best_of_3.winAt).toBe(2);
    expect(MATCH_FORMAT_BOUNDS.best_of_5.winAt).toBe(3);
  });
  it("has a Thai label for every format", () => {
    expect(MATCH_FORMAT_LABEL_TH.fixed_2).toBeTruthy();
    expect(MATCH_FORMAT_LABEL_TH.best_of_3).toBeTruthy();
    expect(MATCH_FORMAT_LABEL_TH.best_of_5).toBeTruthy();
  });
});

describe("isMatchComplete — fixed_2", () => {
  it("needs both games (draw allowed)", () => {
    expect(isMatchComplete([g(21, 15)], "fixed_2")).toBe(false); // only 1 game
    expect(isMatchComplete([g(21, 15), g(15, 21)], "fixed_2")).toBe(true); // 1-1 draw OK
    expect(isMatchComplete([g(21, 15), g(21, 18)], "fixed_2")).toBe(true); // 2-0
  });
  it("rejects more than 2 games", () => {
    expect(isMatchComplete([g(21, 15), g(15, 21), g(21, 18)], "fixed_2")).toBe(false);
  });
});

describe("isMatchComplete — best_of_3", () => {
  it("complete when a side reaches 2 games", () => {
    expect(isMatchComplete([g(21, 15)], "best_of_3")).toBe(false); // 1-0 incomplete
    expect(isMatchComplete([g(21, 15), g(21, 18)], "best_of_3")).toBe(true); // 2-0
    expect(isMatchComplete([g(21, 15), g(15, 21), g(21, 18)], "best_of_3")).toBe(true); // 2-1
  });
  it("1-1 (no decider) is NOT complete", () => {
    expect(isMatchComplete([g(21, 15), g(15, 21)], "best_of_3")).toBe(false);
  });
  it("rejects more than 3 games", () => {
    expect(
      isMatchComplete([g(21, 15), g(15, 21), g(21, 18), g(21, 10)], "best_of_3"),
    ).toBe(false);
  });
});

describe("isMatchComplete — best_of_5", () => {
  it("complete when a side reaches 3 games", () => {
    expect(isMatchComplete([g(21, 1), g(21, 2)], "best_of_5")).toBe(false); // 2-0 incomplete
    expect(isMatchComplete([g(21, 1), g(21, 2), g(21, 3)], "best_of_5")).toBe(true); // 3-0
    expect(
      isMatchComplete([g(21, 1), g(1, 21), g(21, 2), g(2, 21), g(21, 3)], "best_of_5"),
    ).toBe(true); // 3-2
  });
});

describe("isMatchComplete — edge", () => {
  it("empty games never complete (BYE filtered elsewhere)", () => {
    expect(isMatchComplete([], "fixed_2")).toBe(false);
    expect(isMatchComplete([], "best_of_3")).toBe(false);
    expect(isMatchComplete([], "best_of_5")).toBe(false);
  });
});
