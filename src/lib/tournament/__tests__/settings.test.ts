import { describe, it, expect } from "vitest";
import { parseSettings, DEFAULT_SETTINGS, TournamentSettingsSchema } from "../settings";

// ---------------------------------------------------------------------------
// DEFAULT_SETTINGS shape
// ---------------------------------------------------------------------------
describe("DEFAULT_SETTINGS", () => {
  it("is a valid parsed settings object", () => {
    const result = TournamentSettingsSchema.safeParse(DEFAULT_SETTINGS);
    expect(result.success).toBe(true);
  });

  it("has expected default values for key fields", () => {
    expect(DEFAULT_SETTINGS.auto_rotate_rest_gap).toBe(2);
    expect(DEFAULT_SETTINGS.queue_division_order).toBe("interleaved");
    expect(DEFAULT_SETTINGS.court_strict).toBe(true);
    expect(DEFAULT_SETTINGS.realtime_enabled).toBe(true);
    expect(DEFAULT_SETTINGS.audit_log_enabled).toBe(true);
    expect(DEFAULT_SETTINGS.match_cooldown_minutes).toBe(0);
    expect(DEFAULT_SETTINGS.auto_advance_next).toBe(false);
    expect(DEFAULT_SETTINGS.require_court_to_start).toBe(false);
    expect(DEFAULT_SETTINGS.require_checkin).toBe(false);
    expect(DEFAULT_SETTINGS.allow_force_bracket_reset).toBe(false);
    expect(DEFAULT_SETTINGS.allow_manual_match_after_bracket).toBe(true);
  });

  it("line_notify defaults all true", () => {
    expect(DEFAULT_SETTINGS.line_notify.start).toBe(true);
    expect(DEFAULT_SETTINGS.line_notify.score).toBe(true);
    expect(DEFAULT_SETTINGS.line_notify.bracket).toBe(true);
    expect(DEFAULT_SETTINGS.line_notify.status).toBe(true);
  });

  it("queue_division_priority defaults to empty array", () => {
    expect(DEFAULT_SETTINGS.queue_division_priority).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseSettings — null / non-object inputs
// ---------------------------------------------------------------------------
describe("parseSettings with null / non-object inputs", () => {
  it("null input → DEFAULT_SETTINGS", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("undefined input → DEFAULT_SETTINGS", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("string input → DEFAULT_SETTINGS", () => {
    expect(parseSettings("hello")).toEqual(DEFAULT_SETTINGS);
  });

  it("number input → DEFAULT_SETTINGS", () => {
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("boolean input → DEFAULT_SETTINGS", () => {
    expect(parseSettings(true)).toEqual(DEFAULT_SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// parseSettings — empty object → DEFAULT_SETTINGS
// ---------------------------------------------------------------------------
describe("parseSettings empty object", () => {
  it("{} → DEFAULT_SETTINGS", () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// parseSettings — valid full object
// ---------------------------------------------------------------------------
describe("parseSettings with valid settings", () => {
  it("passes through all valid fields", () => {
    const input = {
      auto_rotate_rest_gap: 3,
      queue_division_order: "chunked",
      court_strict: false,
      realtime_enabled: false,
      match_cooldown_minutes: 5,
    };
    const result = parseSettings(input);
    expect(result.auto_rotate_rest_gap).toBe(3);
    expect(result.queue_division_order).toBe("chunked");
    expect(result.court_strict).toBe(false);
    expect(result.realtime_enabled).toBe(false);
    expect(result.match_cooldown_minutes).toBe(5);
  });

  it("ignores unknown keys (they don't end up on result)", () => {
    const input = { __unknown_key__: "evil", realtime_enabled: false };
    const result = parseSettings(input);
    expect((result as Record<string, unknown>)["__unknown_key__"]).toBeUndefined();
    expect(result.realtime_enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSettings — partial corruption: per-field fallback
// ---------------------------------------------------------------------------
describe("parseSettings partial corruption", () => {
  it("invalid field value falls back to default for that field", () => {
    // match_cooldown_minutes must be int 0-30; passing -1 should fall back to 0
    const input = { match_cooldown_minutes: -1, realtime_enabled: false };
    const result = parseSettings(input);
    expect(result.match_cooldown_minutes).toBe(DEFAULT_SETTINGS.match_cooldown_minutes);
    // valid field is preserved
    expect(result.realtime_enabled).toBe(false);
  });

  it("invalid queue_division_order falls back to default", () => {
    const input = { queue_division_order: "invalid_value" };
    const result = parseSettings(input);
    expect(result.queue_division_order).toBe(DEFAULT_SETTINGS.queue_division_order);
  });

  it("invalid auto_rotate_rest_gap (> 5) falls back to default", () => {
    const input = { auto_rotate_rest_gap: 99 };
    const result = parseSettings(input);
    expect(result.auto_rotate_rest_gap).toBe(DEFAULT_SETTINGS.auto_rotate_rest_gap);
  });

  it("invalid line_notify (non-object) falls back to defaults for that field", () => {
    const input = { line_notify: "not_an_object" };
    const result = parseSettings(input);
    // Should fall back to DEFAULT_SETTINGS.line_notify
    expect(result.line_notify).toEqual(DEFAULT_SETTINGS.line_notify);
  });

  it("one corrupt line_notify sub-flag does NOT wipe its valid siblings", () => {
    // Manual DB edit mangles a single flag (start: "yes" — a string, not boolean).
    // The user had score:false + bracket:false set; those must survive. Only the
    // corrupt `start` falls back to its default (true). Old code reset all four.
    const input = {
      line_notify: { start: "yes", score: false, bracket: false, status: true },
    };
    const result = parseSettings(input);
    expect(result.line_notify.score).toBe(false); // sibling preserved
    expect(result.line_notify.bracket).toBe(false); // sibling preserved
    expect(result.line_notify.status).toBe(true); // sibling preserved
    expect(result.line_notify.start).toBe(true); // corrupt one → default
  });

  it("corrupt line_notify sub-flag does not affect other top-level fields", () => {
    const input = {
      line_notify: { score: "nope" },
      realtime_enabled: false,
      auto_rotate_rest_gap: 4,
    };
    const result = parseSettings(input);
    expect(result.realtime_enabled).toBe(false);
    expect(result.auto_rotate_rest_gap).toBe(4);
    // line_notify.score corrupt → its own default (true); siblings stay default true
    expect(result.line_notify.score).toBe(true);
  });

  it("partially-specified valid line_notify keeps unspecified flags at default", () => {
    // Only `score` provided and valid → it wins; the other three default to true.
    const input = { line_notify: { score: false } };
    const result = parseSettings(input);
    expect(result.line_notify.score).toBe(false);
    expect(result.line_notify.start).toBe(true);
    expect(result.line_notify.bracket).toBe(true);
    expect(result.line_notify.status).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseSettings — legacy queue_bracket_preference translation
// ---------------------------------------------------------------------------
describe("parseSettings legacy queue_bracket_preference", () => {
  it("upper_first → sequential + [1,2]", () => {
    const result = parseSettings({ queue_bracket_preference: "upper_first" });
    expect(result.queue_division_order).toBe("sequential");
    expect(result.queue_division_priority).toEqual([1, 2]);
  });

  it("lower_first → sequential + [2,1]", () => {
    const result = parseSettings({ queue_bracket_preference: "lower_first" });
    expect(result.queue_division_order).toBe("sequential");
    expect(result.queue_division_priority).toEqual([2, 1]);
  });

  it("interleaved (legacy) → interleaved + []", () => {
    const result = parseSettings({ queue_bracket_preference: "interleaved" });
    expect(result.queue_division_order).toBe("interleaved");
    expect(result.queue_division_priority).toEqual([]);
  });

  it("chunk_upper_first → chunked + [1,2]", () => {
    const result = parseSettings({ queue_bracket_preference: "chunk_upper_first" });
    expect(result.queue_division_order).toBe("chunked");
    expect(result.queue_division_priority).toEqual([1, 2]);
  });

  it("chunk_lower_first → chunked + [2,1]", () => {
    const result = parseSettings({ queue_bracket_preference: "chunk_lower_first" });
    expect(result.queue_division_order).toBe("chunked");
    expect(result.queue_division_priority).toEqual([2, 1]);
  });

  it("unknown legacy value → drops the key, uses defaults", () => {
    const result = parseSettings({ queue_bracket_preference: "unknown_garbage" });
    expect(result.queue_division_order).toBe(DEFAULT_SETTINGS.queue_division_order);
  });

  it("legacy key is not present in output", () => {
    const result = parseSettings({ queue_bracket_preference: "upper_first" });
    expect((result as Record<string, unknown>)["queue_bracket_preference"]).toBeUndefined();
  });

  it("queue_division_order already present takes precedence over legacy key", () => {
    const result = parseSettings({
      queue_bracket_preference: "upper_first",
      queue_division_order: "chunked",
    });
    expect(result.queue_division_order).toBe("chunked");
  });

  it("strips legacy key even when queue_division_order is present", () => {
    const result = parseSettings({
      queue_bracket_preference: "upper_first",
      queue_division_order: "sequential",
    });
    expect((result as Record<string, unknown>)["queue_bracket_preference"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseSettings — TV display fields
// ---------------------------------------------------------------------------
describe("parseSettings TV display fields", () => {
  it("tv_standings_font_size valid value passes through", () => {
    const result = parseSettings({ tv_standings_font_size: "lg" });
    expect(result.tv_standings_font_size).toBe("lg");
  });

  it("invalid tv_standings_font_size falls back to 'md'", () => {
    const result = parseSettings({ tv_standings_font_size: "xxl" });
    expect(result.tv_standings_font_size).toBe("md");
  });

  it("tv_completed_count out of range (> 3) falls back to default", () => {
    const result = parseSettings({ tv_completed_count: 10 });
    expect(result.tv_completed_count).toBe(DEFAULT_SETTINGS.tv_completed_count);
  });

  it("chart_orientation 'horizontal' is valid", () => {
    const result = parseSettings({ chart_orientation: "horizontal" });
    expect(result.chart_orientation).toBe("horizontal");
  });

  it("chart_orientation default is 'vertical'", () => {
    expect(DEFAULT_SETTINGS.chart_orientation).toBe("vertical");
  });
});
