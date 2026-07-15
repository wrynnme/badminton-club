import { describe, it, expect } from "vitest";
import {
  DEFAULT_SESSION_DEFAULTS,
  SESSION_FALLBACKS,
  buildSessionDefaultsFromClub,
  parseSessionDefaults,
} from "@/lib/club/session-defaults";
import { DEFAULT_QUEUE_SETTINGS } from "@/lib/club/queue-settings";
import type { Club } from "@/lib/types";

describe("parseSessionDefaults", () => {
  it("returns all defaults for {}", () => {
    expect(parseSessionDefaults({})).toEqual(DEFAULT_SESSION_DEFAULTS);
  });

  it("returns all defaults for null / undefined / non-object input", () => {
    expect(parseSessionDefaults(null)).toEqual(DEFAULT_SESSION_DEFAULTS);
    expect(parseSessionDefaults(undefined)).toEqual(DEFAULT_SESSION_DEFAULTS);
    expect(parseSessionDefaults("garbage")).toEqual(DEFAULT_SESSION_DEFAULTS);
    expect(parseSessionDefaults([1, 2, 3])).toEqual(DEFAULT_SESSION_DEFAULTS);
  });

  it("parses the exact backfill-migration jsonb shape (20260715000300)", () => {
    const backfillShape = {
      venue: "โรงยิม ม.เกษตร",
      start_time: "18:00:00",
      end_time: "21:00:00",
      max_players: 16,
      court_fee: 400,
      shuttle_price: 22,
      court_split: "even",
      shuttle_split: "per_match",
      courts: ["A", "B"],
      queue_settings: {
        court_count: 2,
        players_per_team: 2,
        rotation_mode: "fair_queue",
        queue_mode: "rest_longest",
      },
    };

    const parsed = parseSessionDefaults(backfillShape);
    expect(parsed.venue).toBe("โรงยิม ม.เกษตร");
    expect(parsed.start_time).toBe("18:00:00");
    expect(parsed.end_time).toBe("21:00:00");
    expect(parsed.max_players).toBe(16);
    expect(parsed.court_fee).toBe(400);
    expect(parsed.shuttle_price).toBe(22);
    expect(parsed.court_split).toBe("even");
    expect(parsed.shuttle_split).toBe("per_match");
    expect(parsed.courts).toEqual(["A", "B"]);
    expect(parsed.queue_settings.court_count).toBe(2);
    expect(parsed.queue_settings.queue_mode).toBe("rest_longest");
  });

  it("per-field fallback: a corrupted field degrades alone, others survive", () => {
    const parsed = parseSessionDefaults({
      venue: "สนามเทพ",
      max_players: "not-a-number",
      court_split: "sideways",
    });
    expect(parsed.venue).toBe("สนามเทพ");
    expect(parsed.max_players).toBeNull();
    expect(parsed.court_split).toBeNull();
  });

  it("recovers a legacy/partial queue_settings block via parseQueueSettings instead of failing the whole object", () => {
    const parsed = parseSessionDefaults({ venue: "A", queue_settings: { queue_mode: "smart" } });
    expect(parsed.venue).toBe("A");
    // legacy "smart" folds to level_match (see normalizeLegacyQueueValues)
    expect(parsed.queue_settings.queue_mode).toBe("level_match");
    expect(parsed.queue_settings.skill_level_enabled).toBe(true);
  });

  it("SESSION_FALLBACKS match applyClubPresetAction's hardcoded new-club defaults", () => {
    expect(SESSION_FALLBACKS).toEqual({
      venue: "ก๊วน",
      start_time: "18:00",
      end_time: "21:00",
      max_players: 12,
    });
  });
});

describe("buildSessionDefaultsFromClub", () => {
  it("round-trips through parseSessionDefaults", () => {
    const club = {
      venue: "สนาม A",
      start_time: "18:00:00",
      end_time: "21:00:00",
      max_players: 12,
      court_fee: 300,
      shuttle_price: 20,
      court_split: "even",
      shuttle_split: "even",
      courts: ["1", "2"],
      queue_settings: DEFAULT_QUEUE_SETTINGS,
    } as unknown as Club;

    const built = buildSessionDefaultsFromClub(club);
    const parsed = parseSessionDefaults(built);
    expect(parsed.venue).toBe("สนาม A");
    expect(parsed.start_time).toBe("18:00:00");
    expect(parsed.max_players).toBe(12);
    expect(parsed.court_fee).toBe(300);
    expect(parsed.courts).toEqual(["1", "2"]);
    expect(parsed.queue_settings).toEqual(DEFAULT_QUEUE_SETTINGS);
  });
});
