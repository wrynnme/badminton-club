import { describe, it, expect } from "vitest";
import {
  parseBillingVerifySettings,
  DEFAULT_BILLING_VERIFY_SETTINGS,
} from "../billing-verify-settings";

describe("parseBillingVerifySettings", () => {
  // ---------------------------------------------------------------------------
  // Default / empty input
  // ---------------------------------------------------------------------------

  it("null → default settings", () => {
    expect(parseBillingVerifySettings(null)).toEqual(DEFAULT_BILLING_VERIFY_SETTINGS);
  });

  it("undefined → default settings", () => {
    expect(parseBillingVerifySettings(undefined)).toEqual(DEFAULT_BILLING_VERIFY_SETTINGS);
  });

  it("empty object → all defaults", () => {
    const result = parseBillingVerifySettings({});
    expect(result).toEqual({
      mode: "manual",
      provider: null,
      branch_id: null,
      key_set: false,
    });
  });

  it("array (corrupt) → default settings", () => {
    expect(parseBillingVerifySettings([])).toEqual(DEFAULT_BILLING_VERIFY_SETTINGS);
  });

  it("primitive string (corrupt) → default settings", () => {
    expect(parseBillingVerifySettings("broken")).toEqual(DEFAULT_BILLING_VERIFY_SETTINGS);
  });

  // ---------------------------------------------------------------------------
  // manual mode
  // ---------------------------------------------------------------------------

  it("explicit mode=manual → manual with null provider/branch", () => {
    const result = parseBillingVerifySettings({ mode: "manual" });
    expect(result.mode).toBe("manual");
    expect(result.provider).toBeNull();
    expect(result.branch_id).toBeNull();
    expect(result.key_set).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // byok mode — easyslip
  // ---------------------------------------------------------------------------

  it("byok + easyslip → parsed correctly, branch_id null", () => {
    const result = parseBillingVerifySettings({
      mode: "byok",
      provider: "easyslip",
      key_set: true,
    });
    expect(result.mode).toBe("byok");
    expect(result.provider).toBe("easyslip");
    expect(result.branch_id).toBeNull();
    expect(result.key_set).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // byok mode — slipok with branch_id
  // ---------------------------------------------------------------------------

  it("byok + slipok + branch_id → all fields parsed", () => {
    const result = parseBillingVerifySettings({
      mode: "byok",
      provider: "slipok",
      branch_id: "12345",
      key_set: true,
    });
    expect(result.mode).toBe("byok");
    expect(result.provider).toBe("slipok");
    expect(result.branch_id).toBe("12345");
    expect(result.key_set).toBe(true);
  });

  it("branch_id longer than 64 chars → falls back to null (field-level fallback)", () => {
    const result = parseBillingVerifySettings({
      mode: "byok",
      provider: "slipok",
      branch_id: "x".repeat(65),
    });
    // branch_id fails its own field validation → per-field fallback keeps default (null)
    expect(result.branch_id).toBeNull();
    // other valid fields are still kept
    expect(result.mode).toBe("byok");
    expect(result.provider).toBe("slipok");
  });

  // ---------------------------------------------------------------------------
  // Partial / corrupt input — per-field fallback
  // ---------------------------------------------------------------------------

  it("invalid mode value → falls back to 'manual' (field-level)", () => {
    const result = parseBillingVerifySettings({ mode: "unknown_mode" });
    expect(result.mode).toBe("manual");
  });

  it("invalid provider value → falls back to null (field-level)", () => {
    const result = parseBillingVerifySettings({
      mode: "byok",
      provider: "unknown_provider",
    });
    expect(result.provider).toBeNull();
  });

  it("non-boolean key_set → falls back to false (field-level)", () => {
    const result = parseBillingVerifySettings({ key_set: "yes" });
    expect(result.key_set).toBe(false);
  });

  it("partial corrupt + valid fields → keeps valid, falls back rest", () => {
    const result = parseBillingVerifySettings({
      mode: "byok",
      provider: 999,        // invalid
      branch_id: "abc",     // valid
      key_set: true,        // valid
    });
    expect(result.mode).toBe("byok");
    expect(result.provider).toBeNull();   // fallback
    expect(result.branch_id).toBe("abc");
    expect(result.key_set).toBe(true);
  });

  it("extra unknown keys are silently ignored", () => {
    const result = parseBillingVerifySettings({
      mode: "manual",
      future_field: "some_value",
    });
    expect(result).toEqual({
      mode: "manual",
      provider: null,
      branch_id: null,
      key_set: false,
    });
    expect((result as Record<string, unknown>).future_field).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // DEFAULT_BILLING_VERIFY_SETTINGS sanity
  // ---------------------------------------------------------------------------

  it("DEFAULT_BILLING_VERIFY_SETTINGS is manual/null/null/false", () => {
    expect(DEFAULT_BILLING_VERIFY_SETTINGS).toEqual({
      mode: "manual",
      provider: null,
      branch_id: null,
      key_set: false,
    });
  });
});
