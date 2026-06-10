import { describe, it, expect } from "vitest";
import {
  parsePresetConfig,
  DEFAULT_PRESET_CONFIG,
  type ClubPresetConfig,
} from "@/lib/club/preset";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaults(): ClubPresetConfig {
  return { ...DEFAULT_PRESET_CONFIG, regulars: [], co_admin_ids: [] };
}

// ─── Empty / null input → all defaults ───────────────────────────────────────

describe("parsePresetConfig — empty / null input", () => {
  it("empty object returns all defaults", () => {
    const result = parsePresetConfig({});
    expect(result.venue).toBe("");
    expect(result.schedule_day).toBe("");
    expect(result.start_time).toBe("");
    expect(result.end_time).toBe("");
    expect(result.max_players).toBe(12);
    expect(result.court_fee).toBe(0);
    expect(result.shuttle_price).toBe(0);
    expect(result.court_count).toBe(1);
    expect(result.players_per_team).toBe(2);
    expect(result.rotation_mode).toBe("fair_queue");
    expect(result.queue_mode).toBe("rest_longest");
    expect(result.co_admin_ids).toEqual([]);
    expect(result.regulars).toEqual([]);
  });

  it("null returns all defaults", () => {
    expect(parsePresetConfig(null)).toEqual(defaults());
  });

  it("undefined returns all defaults", () => {
    expect(parsePresetConfig(undefined)).toEqual(defaults());
  });

  it("array returns all defaults", () => {
    expect(parsePresetConfig([])).toEqual(defaults());
  });

  it("string returns all defaults", () => {
    expect(parsePresetConfig("invalid")).toEqual(defaults());
  });
});

// ─── Partial config → keeps valid fields + defaults for missing ───────────────

describe("parsePresetConfig — partial config", () => {
  it("preserves valid string fields", () => {
    const result = parsePresetConfig({ venue: "สนามA", schedule_day: "พุธ" });
    expect(result.venue).toBe("สนามA");
    expect(result.schedule_day).toBe("พุธ");
    expect(result.max_players).toBe(12); // default
  });

  it("preserves valid time fields", () => {
    const result = parsePresetConfig({ start_time: "19:00", end_time: "21:30" });
    expect(result.start_time).toBe("19:00");
    expect(result.end_time).toBe("21:30");
  });

  it("preserves valid numeric fields", () => {
    const result = parsePresetConfig({ max_players: 20, court_fee: 500, shuttle_price: 25 });
    expect(result.max_players).toBe(20);
    expect(result.court_fee).toBe(500);
    expect(result.shuttle_price).toBe(25);
  });

  it("preserves valid rotation_mode", () => {
    const result = parsePresetConfig({ rotation_mode: "winner_stays" });
    expect(result.rotation_mode).toBe("winner_stays");
    expect(result.queue_mode).toBe("rest_longest"); // default unchanged
  });

  it("preserves valid queue_mode", () => {
    const result = parsePresetConfig({ queue_mode: "fifo" });
    expect(result.queue_mode).toBe("fifo");
  });

  it("preserves valid players_per_team=1", () => {
    const result = parsePresetConfig({ players_per_team: 1 });
    expect(result.players_per_team).toBe(1);
  });

  it("preserves valid co_admin_ids array", () => {
    const ids = ["a1b2c3d4-e5f6-4789-abcd-ef0123456701", "a1b2c3d4-e5f6-4789-abcd-ef0123456702"];
    const result = parsePresetConfig({ co_admin_ids: ids });
    expect(result.co_admin_ids).toEqual(ids);
  });

  it("only-some-fields present fills rest with defaults", () => {
    const result = parsePresetConfig({ venue: "สนาม X", court_count: 3 });
    expect(result.venue).toBe("สนาม X");
    expect(result.court_count).toBe(3);
    expect(result.max_players).toBe(12);
    expect(result.rotation_mode).toBe("fair_queue");
    expect(result.regulars).toEqual([]);
  });
});

// ─── Bad types → clamped / fallback to default ───────────────────────────────

describe("parsePresetConfig — bad / out-of-range types", () => {
  it("court_count=999 falls back to default (fails max=20)", () => {
    const result = parsePresetConfig({ court_count: 999 });
    expect(result.court_count).toBe(1); // default
  });

  it("court_count=0 falls back to default (fails min=1)", () => {
    const result = parsePresetConfig({ court_count: 0 });
    expect(result.court_count).toBe(1);
  });

  it("players_per_team=3 falls back to default (not literal 1|2)", () => {
    const result = parsePresetConfig({ players_per_team: 3 });
    expect(result.players_per_team).toBe(2); // default
  });

  it("max_players=string falls back to default", () => {
    const result = parsePresetConfig({ max_players: "x" });
    expect(result.max_players).toBe(12);
  });

  it("max_players=1 falls back to default (below min=2)", () => {
    const result = parsePresetConfig({ max_players: 1 });
    expect(result.max_players).toBe(12);
  });

  it("max_players=41 falls back to default (above max=40)", () => {
    const result = parsePresetConfig({ max_players: 41 });
    expect(result.max_players).toBe(12);
  });

  it("rotation_mode='invalid' falls back to default", () => {
    const result = parsePresetConfig({ rotation_mode: "invalid_mode" });
    expect(result.rotation_mode).toBe("fair_queue");
  });

  it("queue_mode='invalid' falls back to default", () => {
    const result = parsePresetConfig({ queue_mode: "invalid_mode" });
    expect(result.queue_mode).toBe("rest_longest");
  });

  it("court_fee negative falls back to default (min=0)", () => {
    const result = parsePresetConfig({ court_fee: -10 });
    expect(result.court_fee).toBe(0);
  });

  it("shuttle_price negative falls back to default", () => {
    const result = parsePresetConfig({ shuttle_price: -5 });
    expect(result.shuttle_price).toBe(0);
  });

  it("co_admin_ids non-array falls back to default", () => {
    const result = parsePresetConfig({ co_admin_ids: "not-an-array" });
    expect(result.co_admin_ids).toEqual([]);
  });

  it("bad field does not poison valid sibling fields", () => {
    const result = parsePresetConfig({
      court_count: 999, // bad
      venue: "สนามดี", // good
      max_players: 16, // good
    });
    expect(result.court_count).toBe(1); // fallback
    expect(result.venue).toBe("สนามดี"); // preserved
    expect(result.max_players).toBe(16); // preserved
  });
});

// ─── Regulars array ───────────────────────────────────────────────────────────

describe("parsePresetConfig — regulars", () => {
  it("preserves valid regulars without optional fields", () => {
    const result = parsePresetConfig({
      regulars: [{ name: "สมชาย" }, { name: "สมหญิง" }],
    });
    expect(result.regulars).toHaveLength(2);
    expect(result.regulars[0].name).toBe("สมชาย");
    expect(result.regulars[1].name).toBe("สมหญิง");
  });

  it("preserves valid regular with profile_id", () => {
    const profileId = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";
    const result = parsePresetConfig({
      regulars: [{ name: "ผู้เล่น A", profile_id: profileId }],
    });
    expect(result.regulars[0].profile_id).toBe(profileId);
  });

  it("preserves valid regular with attendance window", () => {
    const result = parsePresetConfig({
      regulars: [{ name: "ผู้เล่น B", start_time: "19:00", end_time: "21:00" }],
    });
    expect(result.regulars[0].start_time).toBe("19:00");
    expect(result.regulars[0].end_time).toBe("21:00");
  });

  it("preserves regular with null profile_id", () => {
    const result = parsePresetConfig({
      regulars: [{ name: "แขก", profile_id: null }],
    });
    expect(result.regulars[0].profile_id).toBeNull();
  });

  it("preserves regular with null start/end times", () => {
    const result = parsePresetConfig({
      regulars: [{ name: "ผู้เล่น C", start_time: null, end_time: null }],
    });
    expect(result.regulars[0].start_time).toBeNull();
    expect(result.regulars[0].end_time).toBeNull();
  });

  it("regulars without profile_id/times → fields are undefined (optional)", () => {
    const result = parsePresetConfig({ regulars: [{ name: "ผู้เล่น D" }] });
    const reg = result.regulars[0];
    expect(reg.name).toBe("ผู้เล่น D");
    // profile_id, start_time, end_time are optional — may be undefined
    expect("profile_id" in reg ? reg.profile_id : undefined).toBeUndefined();
  });

  it("empty regulars array preserved", () => {
    const result = parsePresetConfig({ regulars: [] });
    expect(result.regulars).toEqual([]);
  });

  it("invalid regulars array (non-array) falls back to empty array", () => {
    const result = parsePresetConfig({ regulars: "not-an-array" });
    expect(result.regulars).toEqual([]);
  });

  it("regular missing name causes entire regulars field to fall back (name is required min=1)", () => {
    // A regular with empty name fails the z.string().min(1) check on the whole array
    const result = parsePresetConfig({
      regulars: [{ name: "" }],
    });
    // Whole array fails → falls back to default empty array
    expect(result.regulars).toEqual([]);
  });

  it("full preset with multiple regulars and mixed optional fields", () => {
    const profileId = "a1b2c3d4-e5f6-4789-abcd-ef0123456701";
    const result = parsePresetConfig({
      venue: "สนาม B",
      max_players: 8,
      court_count: 2,
      regulars: [
        { name: "สมชาย", profile_id: profileId, start_time: "19:00", end_time: "21:00" },
        { name: "แขก", profile_id: null },
        { name: "ผู้เล่น 3" },
      ],
    });
    expect(result.venue).toBe("สนาม B");
    expect(result.max_players).toBe(8);
    expect(result.court_count).toBe(2);
    expect(result.regulars).toHaveLength(3);
    expect(result.regulars[0].profile_id).toBe(profileId);
    expect(result.regulars[1].profile_id).toBeNull();
  });
});

// ─── Full valid config round-trips cleanly ────────────────────────────────────

describe("parsePresetConfig — full valid config", () => {
  it("round-trips a complete valid config unchanged", () => {
    const full: ClubPresetConfig = {
      venue: "สนามกีฬา ABC",
      schedule_day: "พุธ",
      start_time: "18:30",
      end_time: "21:30",
      max_players: 16,
      court_fee: 800,
      shuttle_price: 30,
      court_count: 4,
      players_per_team: 2,
      rotation_mode: "winner_stays",
      queue_mode: "smart",
      co_admin_ids: ["a1b2c3d4-e5f6-4789-abcd-ef0123456710"],
      regulars: [
        {
          name: "ผู้เล่น 1",
          profile_id: "a1b2c3d4-e5f6-4789-abcd-ef0123456720",
          start_time: "18:30",
          end_time: "21:30",
        },
        { name: "ผู้เล่น 2", profile_id: null },
      ],
    };

    const result = parsePresetConfig(full);
    expect(result.venue).toBe(full.venue);
    expect(result.schedule_day).toBe(full.schedule_day);
    expect(result.start_time).toBe(full.start_time);
    expect(result.end_time).toBe(full.end_time);
    expect(result.max_players).toBe(full.max_players);
    expect(result.court_fee).toBe(full.court_fee);
    expect(result.shuttle_price).toBe(full.shuttle_price);
    expect(result.court_count).toBe(full.court_count);
    expect(result.players_per_team).toBe(full.players_per_team);
    expect(result.rotation_mode).toBe(full.rotation_mode);
    expect(result.queue_mode).toBe(full.queue_mode);
    expect(result.co_admin_ids).toEqual(full.co_admin_ids);
    expect(result.regulars).toHaveLength(2);
    expect(result.regulars[0].profile_id).toBe("a1b2c3d4-e5f6-4789-abcd-ef0123456720");
    expect(result.regulars[1].profile_id).toBeNull();
  });
});
