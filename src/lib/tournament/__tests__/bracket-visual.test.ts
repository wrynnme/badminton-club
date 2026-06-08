import { describe, it, expect } from "vitest";
import { buildVisualBracket, CARD_H } from "@/lib/tournament/bracket-visual";
import type { Match } from "@/lib/types";

// buildVisualBracket only reads bracket / round_number / match_number, so a
// minimal partial is enough.
const m = (over: { bracket?: string; round_number: number; match_number: number }): Match =>
  ({
    id: `${over.bracket ?? "upper"}-${over.round_number}-${over.match_number}`,
    bracket: over.bracket ?? "upper",
    round_number: over.round_number,
    match_number: over.match_number,
  } as unknown as Match);

describe("buildVisualBracket", () => {
  it("lower bracket never drops matches (no single-elim halving slice)", () => {
    // 8-entrant double-elim lower bracket: round sizes [2, 2, 1, 1]. The idx=1
    // round with 2 matches is exactly where the old halving slotCount =
    // round(firstRoundCount / 2^idx) = round(2/2) = 1 sliced a real, playable
    // match out of the rendered bracket.
    const lower: Match[] = [
      m({ bracket: "lower", round_number: 1, match_number: 1 }),
      m({ bracket: "lower", round_number: 1, match_number: 2 }),
      m({ bracket: "lower", round_number: 2, match_number: 3 }),
      m({ bracket: "lower", round_number: 2, match_number: 4 }),
      m({ bracket: "lower", round_number: 3, match_number: 5 }),
      m({ bracket: "lower", round_number: 4, match_number: 6 }),
    ];
    const rounds = buildVisualBracket(lower, "lower");
    const rendered = rounds.flatMap((r) => r.matches).filter(Boolean);
    expect(rendered.length).toBe(lower.length); // all 6 present — none sliced off

    const r2 = rounds.find((r) => r.roundNumber === 2)!;
    expect(r2.matches.filter(Boolean).length).toBe(2); // both round-2 matches kept
    expect(r2.slotHeight).toBe(CARD_H); // uniform height for lower (not doubled)
    expect(r2.label).toBe("สายแพ้ รอบ 2");
  });

  it("upper bracket keeps single-elim halving geometry", () => {
    // 4-entrant upper: round 1 = 2 matches, round 2 (final) = 1 match.
    const upper: Match[] = [
      m({ bracket: "upper", round_number: 1, match_number: 1 }),
      m({ bracket: "upper", round_number: 1, match_number: 2 }),
      m({ bracket: "upper", round_number: 2, match_number: 3 }),
    ];
    const rounds = buildVisualBracket(upper, "upper");
    expect(rounds[0].matches.length).toBe(2);
    expect(rounds[1].matches.length).toBe(1); // halving still applies
    expect(rounds[1].label).toBe("รอบชิงชนะเลิศ");
    expect(rounds.flatMap((r) => r.matches).filter(Boolean).length).toBe(upper.length);
  });

  it("filters by section and returns [] when the section is empty", () => {
    const onlyUpper = [m({ bracket: "upper", round_number: 1, match_number: 1 })];
    expect(buildVisualBracket(onlyUpper, "lower")).toEqual([]);
    expect(buildVisualBracket([], "upper")).toEqual([]);
  });
});
