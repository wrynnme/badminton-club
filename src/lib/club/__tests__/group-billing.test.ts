import { describe, it, expect } from "vitest";
import {
  bucketBillsByAmount,
  buildGroupBillText,
  buildGroupBillMessages,
  type GroupBillPlayer,
  type LineTextMessage,
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

describe("buildGroupBillText — mention offsets", () => {
  it("tags @bee @pang with mentionees whose index/length point exactly at each tag", () => {
    const msg = buildGroupBillText({
      clubName: "แบดเย็นนี้",
      amount: 170,
      members: [
        { displayName: "bee", lineUserId: "Ubee" },
        { displayName: "pang", lineUserId: "Upang" },
      ],
    });

    // Mentions lead the message so their indices start at 0.
    expect(msg.text.startsWith("@bee @pang\n")).toBe(true);
    expect(msg.text).toContain("170 บาท");

    const mentionees = msg.mention!.mentionees;
    expect(mentionees).toHaveLength(2);

    // Every mentionee slice must equal exactly "@<name>" and carry the userId.
    for (const m of mentionees) {
      const slice = msg.text.slice(m.index, m.index + m.length);
      expect(slice[0]).toBe("@");
    }
    expect(msg.text.slice(mentionees[0].index, mentionees[0].index + mentionees[0].length)).toBe("@bee");
    expect(msg.text.slice(mentionees[1].index, mentionees[1].index + mentionees[1].length)).toBe("@pang");
    expect(mentionees[0]).toMatchObject({ index: 0, length: 4, type: "user", userId: "Ubee" });
    // "@bee" (0..3) + " " (4) → "@pang" starts at 5, length 5
    expect(mentionees[1]).toMatchObject({ index: 5, length: 5, type: "user", userId: "Upang" });
  });

  it("emits no mention block when there are no mentionable members", () => {
    const msg = buildGroupBillText({ clubName: "c", amount: 90, members: [] });
    expect(msg.mention).toBeUndefined();
    expect(msg.text).toContain("90 บาท");
  });
});

describe("buildGroupBillMessages — one push per amount", () => {
  it("produces [text(@bee @pang), image(QR)] for the 170 bucket", () => {
    const [b170] = bucketBillsByAmount(SCENARIO);
    const { messages, overflow } = buildGroupBillMessages(b170, {
      clubName: "แบดเย็นนี้",
      qrUrl: "https://cdn.example/qr-170.png",
    });

    expect(overflow).toBe(false);
    expect(messages).toHaveLength(2);

    const [text, image] = messages;
    expect(text.type).toBe("text");
    expect((text as LineTextMessage).mention!.mentionees.map((m) => m.userId)).toEqual([
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
    expect(messages[0].type).toBe("text");
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
    for (const m of messages.slice(0, 5)) {
      if (m.type === "text") {
        expect(m.mention!.mentionees.length).toBeLessThanOrEqual(20);
      }
    }
  });
});
