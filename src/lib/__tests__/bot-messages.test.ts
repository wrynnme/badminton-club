import { describe, it, expect } from "vitest";
import {
  BOT_MESSAGE_KEYS,
  BOT_MESSAGE_SPECS,
  DEFAULT_BOT_MESSAGES,
  renderBotMessage,
  missingRequiredPlaceholders,
  parseBotMessages,
  resolveBotMessage,
} from "../bot-messages";

describe("renderBotMessage", () => {
  it("substitutes known placeholders", () => {
    expect(renderBotMessage('ผูกกับ "{club}" แล้ว', { club: "ก๊วนเช้า" })).toBe('ผูกกับ "ก๊วนเช้า" แล้ว');
  });
  it("coerces numbers", () => {
    expect(renderBotMessage("#{num}", { num: 7 })).toBe("#7");
  });
  it("strips unknown placeholders (typo can't leak a raw brace)", () => {
    expect(renderBotMessage("a {club} b {clbu} c", { club: "X" })).toBe("a X b  c");
  });
  it("renders the 6-var score template fully", () => {
    const out = renderBotMessage(DEFAULT_BOT_MESSAGES.notifyScore, {
      a: "ทีมแดง", b: "ทีมน้ำเงิน", scoreA: 2, scoreB: 1, detail: "21-19, 18-21, 21-15", winner: "ทีมแดง",
    });
    expect(out).toContain("🏸 ทีมแดง vs ทีมน้ำเงิน");
    expect(out).toContain("เกมที่ชนะ: 2:1 (21-19, 18-21, 21-15)");
    expect(out).toContain("ผู้ชนะ: ทีมแดง");
    expect(out).not.toContain("{"); // no leftover placeholder
  });
});

describe("missingRequiredPlaceholders", () => {
  it("flags a required placeholder that was dropped", () => {
    expect(missingRequiredPlaceholders("bindSuccess", "ผูกกลุ่มแล้ว")).toEqual(["club"]);
  });
  it("passes when the required placeholder is present", () => {
    expect(missingRequiredPlaceholders("bindSuccess", "ผูกกับ {club} แล้ว")).toEqual([]);
  });
  it("free-text messages (no required vars) never fail", () => {
    expect(missingRequiredPlaceholders("selfLinkPooled", "อะไรก็ได้")).toEqual([]);
    expect(missingRequiredPlaceholders("selfLinkPooled", "")).toEqual([]);
  });
  it("reports every missing var for the multi-var score message", () => {
    expect(missingRequiredPlaceholders("notifyScore", "{a} vs {b}").sort()).toEqual(
      ["detail", "scoreA", "scoreB", "winner"].sort(),
    );
  });
});

describe("parseBotMessages — tolerant", () => {
  it("keeps only known keys with non-blank string values", () => {
    const parsed = parseBotMessages({
      bindSuccess: "custom {club}",
      selfLinkPooled: "   ", // blank → dropped
      notifyStatus: 123, // non-string → dropped
      unknownKey: "x", // unknown → dropped
    });
    expect(parsed).toEqual({ bindSuccess: "custom {club}" });
  });
  it("returns {} for non-object / null input", () => {
    expect(parseBotMessages(null)).toEqual({});
    expect(parseBotMessages("nope")).toEqual({});
    expect(parseBotMessages(undefined)).toEqual({});
  });
});

describe("resolveBotMessage — override else default, blank falls back", () => {
  it("uses a non-blank override", () => {
    expect(resolveBotMessage({ bindSuccess: "ยินดีต้อนรับ {club}!" }, "bindSuccess", { club: "A" })).toBe(
      "ยินดีต้อนรับ A!",
    );
  });
  it("falls back to default when override is blank", () => {
    expect(resolveBotMessage({ bindSuccess: "   " }, "bindSuccess", { club: "A" })).toBe(
      renderBotMessage(DEFAULT_BOT_MESSAGES.bindSuccess, { club: "A" }),
    );
  });
  it("falls back to default when no overrides map at all", () => {
    expect(resolveBotMessage(null, "selfLinkPooled")).toBe(DEFAULT_BOT_MESSAGES.selfLinkPooled);
    expect(resolveBotMessage(undefined, "bindInvalid")).toBe(DEFAULT_BOT_MESSAGES.bindInvalid);
  });
});

describe("registry integrity", () => {
  it("every default renders clean with its required vars supplied", () => {
    for (const key of BOT_MESSAGE_KEYS) {
      const vars = Object.fromEntries(BOT_MESSAGE_SPECS[key].required.map((v) => [v, "X"]));
      const out = renderBotMessage(DEFAULT_BOT_MESSAGES[key], vars);
      expect(out).not.toContain("{"); // all placeholders resolved
      expect(missingRequiredPlaceholders(key, DEFAULT_BOT_MESSAGES[key])).toEqual([]); // default satisfies its own contract
    }
  });
});
