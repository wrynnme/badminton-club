import { describe, it, expect } from "vitest";
import {
  buildPromptPayPayload,
  crc16ccitt,
  detectPromptPayType,
  isValidPromptPayId,
} from "../promptpay";

describe("crc16ccitt", () => {
  it("matches the canonical CRC-16/CCITT-FALSE check value", () => {
    // The standard check value for "123456789" under CRC-16/CCITT-FALSE is 0x29B1.
    expect(crc16ccitt("123456789")).toBe("29B1");
  });
});

describe("detectPromptPayType / isValidPromptPayId", () => {
  it("classifies by digit count and ignores separators", () => {
    expect(detectPromptPayType("0812345678")).toBe("mobile");
    expect(detectPromptPayType("081-234-5678")).toBe("mobile");
    expect(detectPromptPayType("1234567890123")).toBe("national_id");
    expect(detectPromptPayType("123456789012345")).toBe("ewallet");
    expect(detectPromptPayType("12345")).toBeNull();
  });

  it("validates usable proxy ids", () => {
    expect(isValidPromptPayId("0899999999")).toBe(true);
    expect(isValidPromptPayId("abc")).toBe(false);
    expect(isValidPromptPayId("")).toBe(false);
  });
});

describe("buildPromptPayPayload", () => {
  it("returns '' for an invalid id", () => {
    expect(buildPromptPayPayload("123")).toBe("");
  });

  it("builds a static mobile payload with the right structure + self-consistent CRC", () => {
    const p = buildPromptPayPayload("0899999999");
    expect(p.startsWith("000201")).toBe(true);
    expect(p).toContain("010211"); // static (no amount)
    expect(p).toContain("0016A000000677010111"); // AID sub-tag
    expect(p).toContain("01130066899999999"); // mobile proxy formatted to 0066…
    expect(p).toContain("5303764"); // currency THB
    expect(p).toContain("5802TH"); // country
    expect(p).not.toContain("5404"); // no amount tag present
    // CRC: the trailing 4 chars must equal the CRC over everything before them.
    expect(p.slice(-4)).toBe(crc16ccitt(p.slice(0, -4)));
  });

  it("embeds the amount (dynamic) for a paying player", () => {
    const p = buildPromptPayPayload("0899999999", 330);
    expect(p).toContain("010212"); // dynamic
    expect(p).toContain("5406330.00"); // tag 54, len 06, "330.00"
    expect(p.slice(-4)).toBe(crc16ccitt(p.slice(0, -4)));
  });

  it("uses the national-id proxy tag (02) for a 13-digit id", () => {
    const p = buildPromptPayPayload("1234567890123", 100);
    expect(p).toContain("02131234567890123"); // tag 02, len 13, id verbatim
    expect(p).toContain("5406100.00");
    expect(p.slice(-4)).toBe(crc16ccitt(p.slice(0, -4)));
  });

  it("treats a 0 / negative amount as static", () => {
    expect(buildPromptPayPayload("0899999999", 0)).toContain("010211");
    expect(buildPromptPayPayload("0899999999", -5)).toContain("010211");
  });
});
