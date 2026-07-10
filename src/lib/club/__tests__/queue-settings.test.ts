import { describe, it, expect } from "vitest";
import {
  DEFAULT_QUEUE_SETTINGS,
  parseQueueSettings,
  queueSettingsEqual,
} from "@/lib/club/queue-settings";

describe("queueSettingsEqual", () => {
  it("is true for two identical objects (same reference)", () => {
    expect(queueSettingsEqual(DEFAULT_QUEUE_SETTINGS, DEFAULT_QUEUE_SETTINGS)).toBe(true);
  });

  it("is true for two structurally-equal objects built independently (key order differs)", () => {
    const a = { ...DEFAULT_QUEUE_SETTINGS, players_per_team: 2 as const };
    // Rebuild with keys in a different order than `a` — this is what a real
    // draft object looks like after several `{ ...draft, [key]: value }` spreads.
    const b = {
      realtime_enabled: a.realtime_enabled,
      balance_locked_pairs: a.balance_locked_pairs,
      balance_strictness: a.balance_strictness,
      max_skill_gap: a.max_skill_gap,
      winner_stays_max: a.winner_stays_max,
      game_time_limit_min: a.game_time_limit_min,
      skill_level_enabled: a.skill_level_enabled,
      queue_mode: a.queue_mode,
      rotation_mode: a.rotation_mode,
      players_per_team: a.players_per_team,
      court_count: a.court_count,
    };
    expect(queueSettingsEqual(a, b)).toBe(true);
  });

  it("is false when a single field differs", () => {
    const a = DEFAULT_QUEUE_SETTINGS;
    const b = { ...DEFAULT_QUEUE_SETTINGS, winner_stays_max: 5 };
    expect(queueSettingsEqual(a, b)).toBe(false);
  });

  it("is false when a boolean field differs", () => {
    const a = DEFAULT_QUEUE_SETTINGS;
    const b = { ...DEFAULT_QUEUE_SETTINGS, skill_level_enabled: !a.skill_level_enabled };
    expect(queueSettingsEqual(a, b)).toBe(false);
  });

  it("is true after a value is changed then changed back (round trip)", () => {
    const a = DEFAULT_QUEUE_SETTINGS;
    const changed = { ...a, max_skill_gap: 7 };
    const revert = { ...changed, max_skill_gap: a.max_skill_gap };
    expect(queueSettingsEqual(a, revert)).toBe(true);
  });
});

describe("parseQueueSettings — legacy queue_mode folds", () => {
  it("folds removed fifo → rest_longest", () => {
    expect(parseQueueSettings({ queue_mode: "fifo" }).queue_mode).toBe("rest_longest");
  });

  it("folds legacy smart → level_match", () => {
    expect(parseQueueSettings({ queue_mode: "smart" }).queue_mode).toBe("level_match");
  });

  it("keeps valid level_match", () => {
    expect(parseQueueSettings({ queue_mode: "level_match" }).queue_mode).toBe("level_match");
  });
});

describe("parseQueueSettings — skill_level_enabled coupling", () => {
  it("derives skill_level_enabled=true when flag missing + level_match (e.g. preset apply)", () => {
    expect(parseQueueSettings({ queue_mode: "level_match" }).skill_level_enabled).toBe(true);
  });

  it("derives skill_level_enabled=false when flag missing + non-level_match", () => {
    expect(parseQueueSettings({ queue_mode: "rest_longest" }).skill_level_enabled).toBe(false);
    expect(parseQueueSettings({}).skill_level_enabled).toBe(false);
  });

  it("derives from legacy smart (→level_match) when flag missing", () => {
    expect(parseQueueSettings({ queue_mode: "smart" }).skill_level_enabled).toBe(true);
  });

  it("preserves an explicit stored skill_level_enabled (legacy rows keep behavior)", () => {
    // rest_longest + skill on: legacy side-balancing config — must NOT be flipped off
    expect(
      parseQueueSettings({ queue_mode: "rest_longest", skill_level_enabled: true }).skill_level_enabled,
    ).toBe(true);
    // level_match + skill off: preserved as-is
    expect(
      parseQueueSettings({ queue_mode: "level_match", skill_level_enabled: false }).skill_level_enabled,
    ).toBe(false);
  });
});
