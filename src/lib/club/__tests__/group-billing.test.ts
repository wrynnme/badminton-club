import { describe, it, expect } from "vitest";
import {
  bucketBillsByAmount,
  buildGroupBillText,
  buildGroupBillMessages,
  type GroupBillPlayer,
  type LineTextV2Message,
} from "../group-billing";

// The exact scenario from the product goal:
//   170 บาท → @bee @pang   (one message)
//    90 บาท → @bank @boy   (one message)
const SCENARIO: GroupBillPlayer[] = [
  { playerId: "p-bee", displayName: "bee", lineUserId: "Ubee", amount: 170 },
  { playerId: "p-pang", displayName: "pang", lineUserId: "Upang", amount: 170 },
  { playerId: "p-bank", displayName: "bank", lineUserId: "Ubank", amount: 90 },
  { playerId: "p-boy", displayName: "boy", lineUserId: "Uboy", amount: 90 },
];

describe("bucketBillsByAmount", () => {
  it("buckets the goal scenario into 170→[bee,pang] and 90→[bank,boy], highest first", () => {
    const buckets = bucketBillsByAmount(SCENARIO);

    expect(buckets.map((b) => b.amount)).toEqual([170, 90]);
    expect(buckets[0].members.map((m) => m.displayName)).toEqual(["bee", "pang"]);
    expect(buckets[0].members.map((m) => m.lineUserId)).toEqual(["Ubee", "Upang"]);
    expect(buckets[1].members.map((m) => m.displayName)).toEqual(["bank", "boy"]);
    expect(buckets[1].members.map((m) => m.lineUserId)).toEqual(["Ubank", "Uboy"]);
  });

  it("drops zero/negative amounts", () => {
    const buckets = bucketBillsByAmount([
      { playerId: "a", displayName: "a", lineUserId: "Ua", amount: 0 },
      { playerId: "b", displayName: "b", lineUserId: "Ub", amount: -5 },
      { playerId: "c", displayName: "c", lineUserId: "Uc", amount: 50 },
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].amount).toBe(50);
  });

  it("splits reachable (has LINE) from unreachable (guest) within a bucket", () => {
    const buckets = bucketBillsByAmount([
      { playerId: "a", displayName: "a", lineUserId: "Ua", amount: 100 },
      { playerId: "g", displayName: "guest", lineUserId: null, amount: 100 },
    ]);
    expect(buckets[0].members.map((m) => m.displayName)).toEqual(["a"]);
    expect(buckets[0].unreachable.map((m) => m.displayName)).toEqual(["guest"]);
  });
});

describe("buildGroupBillText — textV2 mention substitution", () => {
  it("leads with {m0} {m1} placeholders mapped to each member's userId", () => {
    const msg = buildGroupBillText({
      clubName: "แบดเย็นนี้",
      amount: 170,
      members: [
        { displayName: "bee", lineUserId: "Ubee" },
        { displayName: "pang", lineUserId: "Upang" },
      ],
    });

    expect(msg.type).toBe("textV2");
    // Placeholders lead the message so the mention renders at the top.
    expect(msg.text.startsWith("{m0} {m1}\n")).toBe(true);
    expect(msg.text).toContain("170 บาท");

    // Each placeholder maps to a user mention carrying the right userId. LINE
    // renders it as "@<live LINE name>" — we never send the @handle text.
    expect(msg.substitution).toEqual({
      m0: { type: "mention", mentionee: { type: "user", userId: "Ubee" } },
      m1: { type: "mention", mentionee: { type: "user", userId: "Upang" } },
    });
  });

  it("uses textV2/substitution, NOT the old text+mentionees receive format", () => {
    // Regression guard for the original bug: the inbound webhook shape
    // ({type:"text", mention:{mentionees:[...]}}) is silently dropped on send.
    const msg = buildGroupBillText({
      clubName: "c",
      amount: 50,
      members: [{ displayName: "a", lineUserId: "Ua" }],
    });
    expect(msg.type).toBe("textV2");
    expect((msg as Record<string, unknown>).mention).toBeUndefined();
    expect(msg.text).not.toContain("@"); // no literal @handle text
  });

  it("emits no substitution when there are no mentionable members", () => {
    const msg = buildGroupBillText({ clubName: "c", amount: 90, members: [] });
    expect(msg.substitution).toBeUndefined();
    expect(msg.text).toContain("90 บาท");
    expect(msg.text.startsWith("ค่าก๊วน")).toBe(true);
  });

  it("strips braces from the club name so they can't be read as placeholders", () => {
    const msg = buildGroupBillText({
      clubName: "ก๊วน{x}",
      amount: 10,
      members: [{ displayName: "a", lineUserId: "Ua" }],
    });
    expect(msg.text).toContain("ก๊วนx");
    expect(msg.text).not.toContain("{x}");
    // our own mention placeholder survives
    expect(msg.text.startsWith("{m0}")).toBe(true);
  });
});

describe("buildGroupBillMessages — one push per amount", () => {
  it("produces [textV2(@bee @pang), image(QR)] for the 170 bucket", () => {
    const [b170] = bucketBillsByAmount(SCENARIO);
    const { messages, overflow } = buildGroupBillMessages(b170, {
      clubName: "แบดเย็นนี้",
      qrUrl: "https://cdn.example/qr-170.png",
    });

    expect(overflow).toBe(false);
    expect(messages).toHaveLength(2);

    const [text, image] = messages;
    expect(text.type).toBe("textV2");
    const sub = (text as LineTextV2Message).substitution!;
    expect([sub.m0.mentionee.userId, sub.m1.mentionee.userId]).toEqual([
      "Ubee",
      "Upang",
    ]);
    expect(image).toEqual({
      type: "image",
      originalContentUrl: "https://cdn.example/qr-170.png",
      previewImageUrl: "https://cdn.example/qr-170.png",
    });
  });

  it("omits the image bubble when no QR url is available", () => {
    const [, b90] = bucketBillsByAmount(SCENARIO);
    const { messages } = buildGroupBillMessages(b90, { clubName: "c", qrUrl: null });
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("textV2");
  });

  it("splits >20 mentions across multiple text messages and flags overflow past 5 bubbles", () => {
    const many: GroupBillPlayer[] = Array.from({ length: 85 }, (_, i) => ({
      playerId: `p${i}`,
      displayName: `u${i}`,
      lineUserId: `U${i}`,
      amount: 120,
    }));
    const [bucket] = bucketBillsByAmount(many);
    const { messages, overflow } = buildGroupBillMessages(bucket, {
      clubName: "c",
      qrUrl: "https://cdn.example/qr.png",
    });
    // 85 members → 5 text chunks (20*4 + 5) + 1 image = 6 → clamped to 5, overflow.
    expect(messages).toHaveLength(5);
    expect(overflow).toBe(true);
    for (const m of messages) {
      if (m.type === "textV2") {
        expect(Object.keys(m.substitution!).length).toBeLessThanOrEqual(20);
      }
    }
  });
});
