import { describe, it, expect } from "vitest";
import { resolvePaymentConfig, resolveReceiptConfig } from "@/lib/club/series-payment";

const club = {
  promptpay_id: "0899999999",
  promptpay_name: "club name",
  promptpay_qr_image: "https://example.com/club-qr.png",
  receipt_template: { footer_note: "legacy footer", fields: { court: true } },
  receipt_logo_url: "https://example.com/club-logo.png",
};

const emptySeries = {
  promptpay_id: null,
  promptpay_name: null,
  promptpay_qr_image: null,
  receipt_template: {},
  receipt_logo_url: null,
};

describe("resolvePaymentConfig", () => {
  it("returns the legacy club values when series is null (not-yet-migrated club)", () => {
    expect(resolvePaymentConfig(null, club)).toEqual({
      promptpay_id: club.promptpay_id,
      promptpay_name: club.promptpay_name,
      promptpay_qr_image: club.promptpay_qr_image,
    });
  });

  it("falls back to the legacy club values field-by-field when the series is unset", () => {
    expect(resolvePaymentConfig(emptySeries, club)).toEqual({
      promptpay_id: club.promptpay_id,
      promptpay_name: club.promptpay_name,
      promptpay_qr_image: club.promptpay_qr_image,
    });
  });

  it("prefers the series value whenever it is set, per field", () => {
    const series = {
      promptpay_id: "0888888888",
      promptpay_name: null, // still unset — falls back to the club's name
      promptpay_qr_image: null,
    };
    expect(resolvePaymentConfig(series, club)).toEqual({
      promptpay_id: "0888888888",
      promptpay_name: club.promptpay_name,
      promptpay_qr_image: club.promptpay_qr_image,
    });
  });

  it("a series value of '' (falsy but not null) still wins over the legacy fallback", () => {
    // Nullish-coalescing (not ||) — a deliberately-cleared empty string on the
    // series must not resurrect the legacy club value.
    const series = { promptpay_id: "", promptpay_name: null, promptpay_qr_image: null };
    expect(resolvePaymentConfig(series, club).promptpay_id).toBe("");
  });
});

describe("resolveReceiptConfig", () => {
  it("returns the legacy club values when series is null", () => {
    expect(resolveReceiptConfig(null, club)).toEqual({
      receipt_template: club.receipt_template,
      receipt_logo_url: club.receipt_logo_url,
    });
  });

  it("falls back to the legacy club template when the series template is the default empty object", () => {
    expect(resolveReceiptConfig(emptySeries, club)).toEqual({
      receipt_template: club.receipt_template,
      receipt_logo_url: club.receipt_logo_url,
    });
  });

  it("falls back when the series template is null/undefined (pre-migration read)", () => {
    expect(
      resolveReceiptConfig(
        { receipt_template: null as unknown as Record<string, unknown>, receipt_logo_url: null },
        club,
      ).receipt_template,
    ).toEqual(club.receipt_template);
  });

  it("prefers the series template once it is a non-empty object", () => {
    const seriesTemplate = { footer_note: "series footer" };
    const series = { ...emptySeries, receipt_template: seriesTemplate };
    expect(resolveReceiptConfig(series, club).receipt_template).toBe(seriesTemplate);
  });

  it("resolves receipt_logo_url independently of the template", () => {
    const series = { ...emptySeries, receipt_logo_url: "https://example.com/series-logo.png" };
    expect(resolveReceiptConfig(series, club).receipt_logo_url).toBe("https://example.com/series-logo.png");
  });
});
