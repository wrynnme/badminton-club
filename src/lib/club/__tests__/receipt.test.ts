import { describe, it, expect } from "vitest";
import {
  parseReceiptTemplate,
  DEFAULT_RECEIPT_TEMPLATE,
  hasBankReceiver,
  resolveReceiptTheme,
  RECEIPT_THEMES,
} from "@/lib/club/receipt";

describe("DEFAULT_RECEIPT_TEMPLATE", () => {
  it("reproduces today's slip: all fields shown, promptpay only, no footer, green", () => {
    expect(DEFAULT_RECEIPT_TEMPLATE).toEqual({
      footer_note: "",
      fields: { court: true, shuttle: true, expense: true, discount: true },
      bank: { name: "", account_no: "", account_name: "" },
      payment_show: { promptpay: true, bank: false },
      theme: "green",
      bank_qr: false,
    });
  });
});

describe("parseReceiptTemplate — non-object / empty inputs fall back to defaults", () => {
  for (const raw of [null, undefined, 42, "x", [], [{ footer_note: "x" }]]) {
    it(`${JSON.stringify(raw)} → defaults`, () => {
      expect(parseReceiptTemplate(raw)).toEqual(DEFAULT_RECEIPT_TEMPLATE);
    });
  }

  it("returns a fresh clone (no shared reference with the default)", () => {
    const a = parseReceiptTemplate({});
    a.fields.court = false;
    expect(DEFAULT_RECEIPT_TEMPLATE.fields.court).toBe(true);
  });
});

describe("parseReceiptTemplate — valid input", () => {
  it("round-trips a fully-specified template and trims strings", () => {
    const out = parseReceiptTemplate({
      footer_note: "  ขอบคุณที่มาเล่น  ",
      fields: { court: false, shuttle: true, expense: false, discount: true },
      bank: { name: " SCB ", account_no: "1234567890", account_name: "  ชมรมแบด  " },
      payment_show: { promptpay: false, bank: true },
      theme: "blue",
      bank_qr: true,
    });
    expect(out).toEqual({
      footer_note: "ขอบคุณที่มาเล่น",
      fields: { court: false, shuttle: true, expense: false, discount: true },
      bank: { name: "SCB", account_no: "1234567890", account_name: "ชมรมแบด" },
      payment_show: { promptpay: false, bank: true },
      theme: "blue",
      bank_qr: true,
    });
  });
});

describe("parseReceiptTemplate — partial / corrupt recovery (read-time tolerance)", () => {
  it("keeps a valid footer_note, defaults the rest", () => {
    const out = parseReceiptTemplate({ footer_note: "hi" });
    expect(out.footer_note).toBe("hi");
    expect(out.fields).toEqual(DEFAULT_RECEIPT_TEMPLATE.fields);
    expect(out.payment_show).toEqual(DEFAULT_RECEIPT_TEMPLATE.payment_show);
  });

  it("recovers a corrupt sub-field without wiping its valid siblings", () => {
    const out = parseReceiptTemplate({
      fields: { court: "yes", shuttle: false, expense: true, discount: false },
    });
    // court corrupt → falls back true; siblings preserved
    expect(out.fields).toEqual({ court: true, shuttle: false, expense: true, discount: false });
  });

  it("over-long footer_note is rejected, falling back to default", () => {
    const out = parseReceiptTemplate({ footer_note: "x".repeat(250) });
    expect(out.footer_note).toBe("");
  });

  it("invalid theme falls back to green; invalid bank_qr falls back to false", () => {
    const out = parseReceiptTemplate({ theme: "neon", bank_qr: "true" });
    expect(out.theme).toBe("green");
    expect(out.bank_qr).toBe(false);
  });

  it("recovers bank fields field-wise", () => {
    const out = parseReceiptTemplate({ bank: { name: "KBank", account_no: 999, account_name: "ก๊วน" } });
    // account_no must be a string → corrupt → default ""; name/account_name preserved
    expect(out.bank).toEqual({ name: "KBank", account_no: "", account_name: "ก๊วน" });
  });
});

describe("hasBankReceiver", () => {
  it("requires both bank name and account number", () => {
    expect(hasBankReceiver({ name: "SCB", account_no: "123", account_name: "x" })).toBe(true);
    expect(hasBankReceiver({ name: "", account_no: "123", account_name: "x" })).toBe(false);
    expect(hasBankReceiver({ name: "SCB", account_no: "  ", account_name: "x" })).toBe(false);
  });
});

describe("resolveReceiptTheme", () => {
  it("returns the matching theme, defaulting unknown/empty to green", () => {
    expect(resolveReceiptTheme("blue")).toBe(RECEIPT_THEMES.blue);
    expect(resolveReceiptTheme("nope")).toBe(RECEIPT_THEMES.green);
    expect(resolveReceiptTheme(null)).toBe(RECEIPT_THEMES.green);
    expect(resolveReceiptTheme(undefined)).toBe(RECEIPT_THEMES.green);
  });
});
