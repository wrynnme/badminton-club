import { describe, it, expect } from "vitest";
import { resolveSlipPayment } from "../slip-payment";
import { buildPromptPayPayload } from "../promptpay";
import { RECEIPT_THEMES } from "../receipt";

const PP_ID = "0812345678";

describe("resolveSlipPayment", () => {
  it("encodes the PromptPay number WITHOUT an amount when `amount` is omitted (group slip)", () => {
    const r = resolveSlipPayment({ promptpay_id: PP_ID, receipt_template: {} }, true, null);
    expect(r.qrValue).toBe(buildPromptPayPayload(PP_ID)); // no amount arg
    // The core promise of the group slip: the payload must NOT match a dynamic
    // (amount-embedded) QR for the same proxy — proves the amount is truly omitted,
    // not just "happens to render the same" (see MEMORY.md: test the property, not
    // a convenient config).
    expect(r.qrValue).not.toBe(buildPromptPayPayload(PP_ID, 100));
    expect(r.ppImage).toBeNull();
    expect(r.anyPayment).toBe(true);
  });

  it("embeds the amount when `amount` is passed (per-player SlipCard path)", () => {
    const r = resolveSlipPayment({ promptpay_id: PP_ID, receipt_template: {} }, true, null, 150);
    expect(r.qrValue).toBe(buildPromptPayPayload(PP_ID, 150));
    expect(r.qrValue).not.toBe(buildPromptPayPayload(PP_ID));
  });

  it("falls back to the uploaded QR image when there is no PromptPay number", () => {
    const r = resolveSlipPayment(
      { promptpay_id: null, receipt_template: {} },
      false,
      "https://example.test/qr.png",
    );
    expect(r.qrValue).toBe("");
    expect(r.ppImage).toBe("https://example.test/qr.png");
    expect(r.anyPayment).toBe(true);
  });

  it("prefers the PromptPay number over an uploaded image when both are present", () => {
    const r = resolveSlipPayment(
      { promptpay_id: PP_ID, receipt_template: {} },
      true,
      "https://example.test/qr.png",
    );
    expect(r.qrValue).toBe(buildPromptPayPayload(PP_ID));
    expect(r.ppImage).toBeNull();
  });

  it("ignores an invalid/unverified number (ppNumber=false) and falls back to the image", () => {
    // e.g. a malformed promptpay_id that failed isValidPromptPayId upstream — the
    // caller still passes the raw id through, but ppNumber=false must block it.
    const r = resolveSlipPayment(
      { promptpay_id: "not-a-real-id", receipt_template: {} },
      false,
      "https://example.test/qr.png",
    );
    expect(r.qrValue).toBe("");
    expect(r.ppImage).toBe("https://example.test/qr.png");
  });

  it("respects payment_show.promptpay=false — no QR value, no image fallback either", () => {
    const r = resolveSlipPayment(
      { promptpay_id: PP_ID, receipt_template: { payment_show: { promptpay: false, bank: false } } },
      true,
      "https://example.test/qr.png",
    );
    expect(r.qrValue).toBe("");
    expect(r.ppImage).toBeNull();
    expect(r.anyPayment).toBe(false);
  });

  it("shows the bank block when configured, independent of PromptPay", () => {
    const r = resolveSlipPayment(
      {
        promptpay_id: null,
        receipt_template: {
          payment_show: { promptpay: true, bank: true },
          bank: { name: "SCB", account_no: "123-4-56789-0", account_name: "Club Owner" },
        },
      },
      false,
      null,
    );
    expect(r.qrValue).toBe("");
    expect(r.ppImage).toBeNull();
    expect(r.showBank).toBe(true);
    expect(r.anyPayment).toBe(true);
    expect(r.tpl.bank.name).toBe("SCB");
  });

  it("reports anyPayment=false when nothing is configured at all", () => {
    const r = resolveSlipPayment({ promptpay_id: null, receipt_template: {} }, false, null);
    expect(r.qrValue).toBe("");
    expect(r.ppImage).toBeNull();
    expect(r.showBank).toBe(false);
    expect(r.anyPayment).toBe(false);
  });

  it("resolves the configured receipt theme", () => {
    const r = resolveSlipPayment(
      { promptpay_id: null, receipt_template: { theme: "blue" } },
      false,
      null,
    );
    expect(r.theme).toEqual(RECEIPT_THEMES.blue);
  });
});
