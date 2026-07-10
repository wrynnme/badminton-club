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
    expect(result.queue_settings.court_count).toBe(1);
    expect(result.queue_settings.players_per_team).toBe(2);
    expect(result.queue_settings.rotation_mode).toBe("fair_queue");
    expect(result.queue_settings.queue_mode).toBe("rest_longest");
    expect(result.courts).toEqual([]);
    expect(result.co_admin_ids).toEqual([]);
    expect(result.promptpay_id).toBeNull();
    expect(result.promptpay_name).toBeNull();
    expect(result.promptpay_qr_image).toBeNull();
    expect(result.receipt_template.payment_show).toEqual({ promptpay: true, bank: false });
    expect(result.receipt_template.bank).toEqual({ name: "", account_no: "", account_name: "" });
    expect(result.receipt_template.theme).toBe("green");
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

  it("preserves valid nested queue_settings.rotation_mode", () => {
    const result = parsePresetConfig({ queue_settings: { rotation_mode: "winner_stays" } });
    expect(result.queue_settings.rotation_mode).toBe("winner_stays");
    expect(result.queue_settings.queue_mode).toBe("rest_longest"); // default unchanged
  });

  it("preserves valid nested queue_settings.queue_mode", () => {
    const result = parsePresetConfig({ queue_settings: { queue_mode: "level_match" } });
    expect(result.queue_settings.queue_mode).toBe("level_match");
  });

  it("preserves valid co_admin_ids array", () => {
    const ids = ["a1b2c3d4-e5f6-4789-abcd-ef0123456701", "a1b2c3d4-e5f6-4789-abcd-ef0123456702"];
    const result = parsePresetConfig({ co_admin_ids: ids });
    expect(result.co_admin_ids).toEqual(ids);
  });

  it("only-some-fields present fills rest with defaults", () => {
    const result = parsePresetConfig({
      venue: "สนาม X",
      queue_settings: { court_count: 3 },
    });
    expect(result.venue).toBe("สนาม X");
    expect(result.queue_settings.court_count).toBe(3);
    expect(result.max_players).toBe(12);
    expect(result.queue_settings.rotation_mode).toBe("fair_queue");
    expect(result.regulars).toEqual([]);
  });

  it("preserves valid payment receiver fields", () => {
    const result = parsePresetConfig({
      promptpay_id: "0812345678",
      promptpay_name: "เจ้าของก๊วน",
      promptpay_qr_image: "https://example.com/qr.png",
      receipt_template: {
        payment_show: { promptpay: true, bank: true },
        bank: {
          name: "SCB",
          account_no: "123-4-56789-0",
          account_name: "Club Owner",
        },
        theme: "blue",
      },
    });
    expect(result.promptpay_id).toBe("0812345678");
    expect(result.promptpay_name).toBe("เจ้าของก๊วน");
    expect(result.promptpay_qr_image).toBe("https://example.com/qr.png");
    expect(result.receipt_template.payment_show).toEqual({ promptpay: true, bank: true });
    expect(result.receipt_template.bank.name).toBe("SCB");
    expect(result.receipt_template.theme).toBe("blue");
  });

  it("recovers valid receipt preset subfields when a sibling is corrupt", () => {
    const result = parsePresetConfig({
      receipt_template: {
        payment_show: { promptpay: false, bank: true },
        bank: {
          name: "KBank",
          account_no: "1112223333",
          account_name: "Receiver",
        },
        theme: "bad-theme",
      },
    });
    expect(result.receipt_template.payment_show).toEqual({ promptpay: false, bank: true });
    expect(result.receipt_template.bank.account_no).toBe("1112223333");
    expect(result.receipt_template.theme).toBe("green");
  });
});

// ─── Full queue_settings fidelity (nested block + named courts) ───────────────

describe("parsePresetConfig — full queue_settings fidelity", () => {
  it("round-trips every queue_settings field, not just the legacy four", () => {
    const result = parsePresetConfig({
      queue_settings: {
        court_count: 3,
        players_per_team: 1,
        rotation_mode: "winner_stays",
        queue_mode: "level_match",
        skill_level_enabled: true,
        game_time_limit_min: 15,
        winner_stays_max: 5,
        max_skill_gap: 2,
        balance_strictness: "strict",
        balance_locked_pairs: true,
        realtime_enabled: false,
      },
      courts: ["คอร์ท A", "สนาม VIP"],
    });
    expect(result.queue_settings.winner_stays_max).toBe(5);
    expect(result.queue_settings.game_time_limit_min).toBe(15);
    expect(result.queue_settings.max_skill_gap).toBe(2);
    expect(result.queue_settings.balance_strictness).toBe("strict");
    expect(result.queue_settings.balance_locked_pairs).toBe(true);
    expect(result.queue_settings.realtime_enabled).toBe(false);
    expect(result.courts).toEqual(["คอร์ท A", "สนาม VIP"]);
  });

  it("derives skill_level_enabled from queue_mode when absent in the nested block", () => {
    const result = parsePresetConfig({ queue_settings: { queue_mode: "level_match" } });
    expect(result.queue_settings.skill_level_enabled).toBe(true);
  });

  it("legacy flat preset (no nested block) folds into queue_settings, preserving the four + defaulting the six formerly-lost fields", () => {
    const result = parsePresetConfig({
      court_count: 3,
      players_per_team: 1,
      rotation_mode: "winner_stays",
      queue_mode: "level_match",
    });
    // legacy four preserved
    expect(result.queue_settings.court_count).toBe(3);
    expect(result.queue_settings.players_per_team).toBe(1);
    expect(result.queue_settings.rotation_mode).toBe("winner_stays");
    expect(result.queue_settings.queue_mode).toBe("level_match");
    // derived + behavior-preserving defaults for the six that used to be lost
    expect(result.queue_settings.skill_level_enabled).toBe(true);
    expect(result.queue_settings.winner_stays_max).toBe(2);
    expect(result.queue_settings.game_time_limit_min).toBe(0);
    expect(result.queue_settings.max_skill_gap).toBe(0);
    expect(result.queue_settings.balance_strictness).toBe("balanced");
    expect(result.queue_settings.balance_locked_pairs).toBe(false);
    expect(result.queue_settings.realtime_enabled).toBe(true);
    // legacy preset never captured named courts
    expect(result.courts).toEqual([]);
  });

  it("legacy flat queue_mode fifo folds to rest_longest inside the nested block", () => {
    const result = parsePresetConfig({ queue_mode: "fifo" });
    expect(result.queue_settings.queue_mode).toBe("rest_longest");
  });

  it("legacy flat queue_mode smart folds to level_match inside the nested block", () => {
    const result = parsePresetConfig({ queue_mode: "smart" });
    expect(result.queue_settings.queue_mode).toBe("level_match");
    expect(result.queue_settings.skill_level_enabled).toBe(true);
  });

  it("recovers a partially-corrupt nested queue_settings via parseQueueSettings", () => {
    const result = parsePresetConfig({
      queue_settings: { queue_mode: "level_match", winner_stays_max: 999, max_skill_gap: 5 },
    });
    // out-of-range winner_stays_max falls back to default 2; valid siblings kept
    expect(result.queue_settings.winner_stays_max).toBe(2);
    expect(result.queue_settings.max_skill_gap).toBe(5);
    expect(result.queue_settings.queue_mode).toBe("level_match");
  });

  it("preserves named courts round-trip", () => {
    const result = parsePresetConfig({ courts: ["A", "B", "C"] });
    expect(result.courts).toEqual(["A", "B", "C"]);
  });
});

// ─── Bad types → clamped / fallback to default ───────────────────────────────

describe("parsePresetConfig — bad / out-of-range types", () => {
  it("nested court_count=999 falls back to default (fails max=20)", () => {
    const result = parsePresetConfig({ queue_settings: { court_count: 999 } });
    expect(result.queue_settings.court_count).toBe(1); // default
  });

  it("nested court_count=0 falls back to default (fails min=1)", () => {
    const result = parsePresetConfig({ queue_settings: { court_count: 0 } });
    expect(result.queue_settings.court_count).toBe(1);
  });

  it("nested players_per_team=3 falls back to default (not literal 1|2)", () => {
    const result = parsePresetConfig({ queue_settings: { players_per_team: 3 } });
    expect(result.queue_settings.players_per_team).toBe(2); // default
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

  it("nested rotation_mode='invalid' falls back to default", () => {
    const result = parsePresetConfig({ queue_settings: { rotation_mode: "invalid_mode" } });
    expect(result.queue_settings.rotation_mode).toBe("fair_queue");
  });

  it("nested queue_mode='invalid' falls back to default", () => {
    const result = parsePresetConfig({ queue_settings: { queue_mode: "invalid_mode" } });
    expect(result.queue_settings.queue_mode).toBe("rest_longest");
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

  it("courts non-array falls back to empty list", () => {
    const result = parsePresetConfig({ courts: "not-an-array" });
    expect(result.courts).toEqual([]);
  });

  it("bad receipt_template shape falls back to default payment receipt config", () => {
    const result = parsePresetConfig({ receipt_template: "not-an-object" });
    expect(result.receipt_template.payment_show).toEqual({ promptpay: true, bank: false });
    expect(result.receipt_template.bank).toEqual({ name: "", account_no: "", account_name: "" });
    expect(result.receipt_template.theme).toBe("green");
  });

  it("bad field does not poison valid sibling fields", () => {
    const result = parsePresetConfig({
      queue_settings: { court_count: 999 }, // bad
      venue: "สนามดี", // good
      max_players: 16, // good
    });
    expect(result.queue_settings.court_count).toBe(1); // fallback
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
      queue_settings: { court_count: 2 },
      regulars: [
        { name: "สมชาย", profile_id: profileId, start_time: "19:00", end_time: "21:00" },
        { name: "แขก", profile_id: null },
        { name: "ผู้เล่น 3" },
      ],
    });
    expect(result.venue).toBe("สนาม B");
    expect(result.max_players).toBe(8);
    expect(result.queue_settings.court_count).toBe(2);
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
      queue_settings: {
        court_count: 4,
        players_per_team: 2,
        rotation_mode: "winner_stays",
        queue_mode: "level_match",
        skill_level_enabled: true,
        game_time_limit_min: 20,
        winner_stays_max: 3,
        max_skill_gap: 2,
        balance_strictness: "strict",
        balance_locked_pairs: true,
        realtime_enabled: false,
      },
      courts: ["คอร์ท A", "สนาม VIP", "3", "4"],
      co_admin_ids: ["a1b2c3d4-e5f6-4789-abcd-ef0123456710"],
      promptpay_id: "0812345678",
      promptpay_name: "ผู้รับเงิน",
      promptpay_qr_image: "https://example.com/qr.png",
      receipt_template: {
        payment_show: { promptpay: true, bank: true },
        bank: {
          name: "SCB",
          account_no: "123-4-56789-0",
          account_name: "ผู้รับเงิน",
        },
        theme: "rose",
      },
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
    expect(result.queue_settings).toEqual(full.queue_settings);
    expect(result.courts).toEqual(full.courts);
    expect(result.co_admin_ids).toEqual(full.co_admin_ids);
    expect(result.promptpay_id).toBe(full.promptpay_id);
    expect(result.promptpay_name).toBe(full.promptpay_name);
    expect(result.promptpay_qr_image).toBe(full.promptpay_qr_image);
    expect(result.receipt_template).toEqual(full.receipt_template);
    expect(result.regulars).toHaveLength(2);
    expect(result.regulars[0].profile_id).toBe("a1b2c3d4-e5f6-4789-abcd-ef0123456720");
    expect(result.regulars[1].profile_id).toBeNull();
  });
});
