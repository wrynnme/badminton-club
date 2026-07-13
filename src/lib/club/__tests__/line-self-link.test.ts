import { describe, it, expect } from "vitest";
import {
  parseSelfLinkCommand,
  classifyRosterMatch,
  normalizeRosterName,
  stripMentions,
  type RosterCandidate,
  type Mentionee,
} from "../line-self-link";

const BOT_TAG = "@ก๊วนแบด";
const selfMention = (index: number): Mentionee => ({
  index,
  length: BOT_TAG.length,
  isSelf: true,
  type: "user",
  userId: "Ubot",
});

describe("parseSelfLinkCommand", () => {
  it("ignores a message that does not @mention the bot", () => {
    expect(parseSelfLinkCommand("เชื่อมไลน์ โจ้", false)).toBeNull();
  });

  it("ignores a bot @mention with no keyword", () => {
    const text = `${BOT_TAG} สวัสดีครับ`;
    expect(parseSelfLinkCommand(text, true, [selfMention(0)])).toBeNull();
  });

  it("extracts the roster name after the keyword (mention first)", () => {
    const text = `${BOT_TAG} เชื่อมไลน์ โจ้`;
    expect(parseSelfLinkCommand(text, true, [selfMention(0)])).toEqual({
      kind: "link",
      rosterName: "โจ้",
    });
  });

  it("handles the mention appearing after the keyword", () => {
    const text = `เชื่อมไลน์ โจ้ ${BOT_TAG}`;
    const idx = text.indexOf(BOT_TAG);
    expect(parseSelfLinkCommand(text, true, [selfMention(idx)])).toEqual({
      kind: "link",
      rosterName: "โจ้",
    });
  });

  it("accepts the 'เชื่อม LINE' spelling and no space before the name", () => {
    expect(parseSelfLinkCommand(`${BOT_TAG} เชื่อม LINE โจ้`, true, [selfMention(0)])).toEqual({
      kind: "link",
      rosterName: "โจ้",
    });
    expect(parseSelfLinkCommand(`${BOT_TAG} เชื่อมไลน์โจ้`, true, [selfMention(0)])).toEqual({
      kind: "link",
      rosterName: "โจ้",
    });
  });

  it("keeps multi-word roster names intact", () => {
    const text = `${BOT_TAG} เชื่อมไลน์ พี่ โจ้`;
    expect(parseSelfLinkCommand(text, true, [selfMention(0)])).toEqual({
      kind: "link",
      rosterName: "พี่ โจ้",
    });
  });

  it("returns usage when the keyword is present but no name follows", () => {
    const text = `${BOT_TAG} เชื่อมไลน์`;
    expect(parseSelfLinkCommand(text, true, [selfMention(0)])).toEqual({ kind: "usage" });
  });

  it("returns null when the bot is mentioned but the text is unrelated", () => {
    const text = `${BOT_TAG} ขอบคุณครับ`;
    expect(parseSelfLinkCommand(text, true, [selfMention(0)])).toBeNull();
  });
});

describe("stripMentions", () => {
  it("removes all mention substrings regardless of order", () => {
    const other = "@สมชาย";
    const text = `${BOT_TAG} ${other} เชื่อมไลน์ เอ`;
    const mentionees: Mentionee[] = [
      { index: 0, length: BOT_TAG.length, isSelf: true },
      { index: BOT_TAG.length + 1, length: other.length, isSelf: false },
    ];
    expect(stripMentions(text, mentionees).trim()).toBe("เชื่อมไลน์ เอ");
  });

  it("returns the text unchanged when there are no mentionees", () => {
    expect(stripMentions("hi", undefined)).toBe("hi");
  });
});

describe("classifyRosterMatch", () => {
  const rows: RosterCandidate[] = [
    { id: "p1", display_name: "โจ้", profile_id: null },
    { id: "p2", display_name: "เอ", profile_id: "prof-A" }, // already linked
    { id: "p3", display_name: "Bank", profile_id: null },
    { id: "p4", display_name: "ต่าย", profile_id: null },
    { id: "p5", display_name: "ต่าย", profile_id: null }, // duplicate name
  ];

  it("auto-links a unique guest match", () => {
    expect(classifyRosterMatch(rows, "โจ้")).toEqual({ kind: "unique", playerId: "p1" });
  });

  it("reports 'taken' when the single match is already linked", () => {
    expect(classifyRosterMatch(rows, "เอ")).toEqual({ kind: "taken" });
  });

  it("reports 'ambiguous' when more than one row shares the name", () => {
    expect(classifyRosterMatch(rows, "ต่าย")).toEqual({ kind: "ambiguous" });
  });

  it("reports 'not_found' for a name absent from the roster", () => {
    expect(classifyRosterMatch(rows, "ไม่มีจริง")).toEqual({ kind: "not_found" });
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(classifyRosterMatch(rows, "  bank  ")).toEqual({ kind: "unique", playerId: "p3" });
  });

  it("treats an empty typed name as not_found", () => {
    expect(classifyRosterMatch(rows, "   ")).toEqual({ kind: "not_found" });
  });
});

describe("normalizeRosterName", () => {
  it("trims, lowercases latin, and collapses whitespace", () => {
    expect(normalizeRosterName("  Bank  ")).toBe("bank");
    expect(normalizeRosterName("พี่   โจ้")).toBe("พี่ โจ้");
  });
});
