import { describe, it, expect } from "vitest";
import {
  buildGroupBillLines,
  formatBillAmount,
  buildImageMessage,
  buildGroupBillListMessages,
  buildGroupBillHeader,
  GROUP_BILL_SCAN_PROMPT,
  type GroupBillPlayer,
  type LineTextV2Message,
} from "../group-billing";

// The product example: two linked players (@mention) + two guests (plain name).
//   1. @bee 150 / 2. @pang 150 / 3. Bank 120 / 4. DA 38
const SCENARIO: GroupBillPlayer[] = [
  { playerId: "p-bee", displayName: "bee", lineUserId: "Ubee", amount: 150 },
  { playerId: "p-pang", displayName: "pang", lineUserId: "Upang", amount: 150 },
  { playerId: "p-bank", displayName: "Bank", lineUserId: null, amount: 120 },
  { playerId: "p-da", displayName: "DA", lineUserId: null, amount: 38 },
];

describe("buildGroupBillLines", () => {
  it("orders amount desc, keeps input order on ties, numbers 1..N, flags mention", () => {
    const lines = buildGroupBillLines(SCENARIO);
    expect(lines.map((l) => l.index)).toEqual([1, 2, 3, 4]);
    expect(lines.map((l) => l.displayName)).toEqual(["bee", "pang", "Bank", "DA"]);
    expect(lines.map((l) => l.amount)).toEqual([150, 150, 120, 38]);
    expect(lines.map((l) => l.mentioned)).toEqual([true, true, false, false]);
  });

  it("drops zero / negative amounts before numbering", () => {
    const lines = buildGroupBillLines([
      { playerId: "a", displayName: "a", lineUserId: "Ua", amount: 0 },
      { playerId: "b", displayName: "b", lineUserId: "Ub", amount: -5 },
      { playerId: "c", displayName: "c", lineUserId: null, amount: 50 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ index: 1, amount: 50, mentioned: false });
  });

  it("does not mutate the caller's array", () => {
    const input = [...SCENARIO];
    buildGroupBillLines(input);
    expect(input.map((p) => p.playerId)).toEqual(SCENARIO.map((p) => p.playerId));
  });

  it("treats an empty-string lineUserId as un-mentioned (not a wasted mention slot)", () => {
    const lines = buildGroupBillLines([
      { playerId: "a", displayName: "a", lineUserId: "", amount: 50 },
    ]);
    // Boolean("") is false → renders as a plain name, consumes no mention budget.
    expect(lines[0].mentioned).toBe(false);
  });
});

describe("formatBillAmount", () => {
  it("trims trailing zeros and adds thousands separators", () => {
    expect(formatBillAmount(150)).toBe("150");
    expect(formatBillAmount(38.5)).toBe("38.5");
    expect(formatBillAmount(1500)).toBe("1,500");
    expect(formatBillAmount(0)).toBe("0");
  });
});

describe("buildImageMessage", () => {
  it("wraps a hosted url as a LINE image message", () => {
    expect(buildImageMessage("https://cdn/qr.png")).toEqual({
      type: "image",
      originalContentUrl: "https://cdn/qr.png",
      previewImageUrl: "https://cdn/qr.png",
    });
  });
});

describe("buildGroupBillHeader — shared by message + preview", () => {
  it("builds `ค่าก๊วน <club> · <date>` and drops the date when absent", () => {
    expect(buildGroupBillHeader("ก๊วนเช้า", "15 ก.ค. 68")).toBe("ค่าก๊วน ก๊วนเช้า · 15 ก.ค. 68");
    expect(buildGroupBillHeader("ก๊วนเช้า")).toBe("ค่าก๊วน ก๊วนเช้า");
  });
  it("strips braces so the club name can't be read as a placeholder", () => {
    expect(buildGroupBillHeader("ก๊วน{x}", "d")).toBe("ค่าก๊วน ก๊วนx · d");
  });
  it("the message builder emits this exact header + the scan prompt", () => {
    const lines = buildGroupBillLines([
      { playerId: "a", displayName: "a", lineUserId: "Ua", amount: 50 },
    ]);
    const { messages } = buildGroupBillListMessages({
      lines,
      clubName: "ก๊วนเช้า",
      dateStr: "15 ก.ค. 68",
      qrImageUrl: "https://cdn/qr.png",
    });
    const t = messages[0] as LineTextV2Message;
    expect(t.text.startsWith(buildGroupBillHeader("ก๊วนเช้า", "15 ก.ค. 68"))).toBe(true);
    expect(t.text.endsWith(GROUP_BILL_SCAN_PROMPT)).toBe(true);
  });
});

describe("buildGroupBillListMessages — one consolidated bill", () => {
  it("renders header + numbered list (mention placeholders + plain names) + scan prompt + QR", () => {
    const lines = buildGroupBillLines(SCENARIO);
    const { messages, overflow, sentPlayerIds } = buildGroupBillListMessages({
      lines,
      clubName: "ก๊วนเช้า",
      dateStr: "15 ก.ค. 68",
      qrImageUrl: "https://cdn/qr.png",
    });

    expect(overflow).toBe(false);
    expect(messages).toHaveLength(2); // 1 text + 1 image
    // normal (no clamp) → every payable player is reported as sent
    expect(sentPlayerIds).toEqual(["p-bee", "p-pang", "p-bank", "p-da"]);

    const [text, image] = messages;
    expect(text.type).toBe("textV2");
    const t = text as LineTextV2Message;
    expect(t.text).toBe(
      "ค่าก๊วน ก๊วนเช้า · 15 ก.ค. 68\n" +
        "1. {m0} 150\n" +
        "2. {m1} 150\n" +
        "3. Bank 120\n" +
        "4. DA 38\n" +
        "สแกน QR ด้านล่างจ่ายได้เลย 🙏",
    );
    // only linked players get a substitution entry; guests are plain text
    expect(t.substitution).toEqual({
      m0: { type: "mention", mentionee: { type: "user", userId: "Ubee" } },
      m1: { type: "mention", mentionee: { type: "user", userId: "Upang" } },
    });
    expect(image).toEqual({
      type: "image",
      originalContentUrl: "https://cdn/qr.png",
      previewImageUrl: "https://cdn/qr.png",
    });
  });

  it("uses textV2/substitution, never the old inbound text+mentionees shape", () => {
    const lines = buildGroupBillLines([
      { playerId: "a", displayName: "a", lineUserId: "Ua", amount: 50 },
    ]);
    const { messages } = buildGroupBillListMessages({
      lines,
      clubName: "c",
      qrImageUrl: null,
    });
    const t = messages[0] as LineTextV2Message;
    expect(t.type).toBe("textV2");
    expect((t as Record<string, unknown>).mention).toBeUndefined();
    expect(t.text).not.toContain("@"); // no literal @handle text
  });

  it("omits the QR image AND the scan prompt when qrImageUrl is null (text-only bill)", () => {
    const lines = buildGroupBillLines(SCENARIO);
    const { messages } = buildGroupBillListMessages({
      lines,
      clubName: "c",
      qrImageUrl: null,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("textV2");
    expect((messages[0] as LineTextV2Message).text).not.toContain("สแกน QR");
  });

  it("emits no substitution when every line is a plain-name guest", () => {
    const lines = buildGroupBillLines([
      { playerId: "g1", displayName: "guestA", lineUserId: null, amount: 90 },
      { playerId: "g2", displayName: "guestB", lineUserId: null, amount: 90 },
    ]);
    const { messages } = buildGroupBillListMessages({ lines, clubName: "c", qrImageUrl: null });
    const t = messages[0] as LineTextV2Message;
    expect(t.substitution).toBeUndefined();
    expect(t.text).toContain("1. guestA 90");
    expect(t.text).toContain("2. guestB 90");
  });

  it("strips braces from club name and guest display names", () => {
    const lines = buildGroupBillLines([
      { playerId: "g", displayName: "gu{est}", lineUserId: null, amount: 10 },
    ]);
    const { messages } = buildGroupBillListMessages({
      lines,
      clubName: "ก๊วน{x}",
      qrImageUrl: null,
    });
    const t = messages[0] as LineTextV2Message;
    expect(t.text).toContain("ก๊วนx");
    expect(t.text).toContain("guest");
    expect(t.text).not.toContain("{x}");
    expect(t.text).not.toContain("{est}");
  });

  it("splits >20 mentions across messages with CONTINUOUS numbering; header first, prompt last", () => {
    const many: GroupBillPlayer[] = Array.from({ length: 25 }, (_, i) => ({
      playerId: `p${i}`,
      displayName: `u${i}`,
      lineUserId: `U${i}`,
      amount: 100,
    }));
    const lines = buildGroupBillLines(many);
    const { messages, overflow } = buildGroupBillListMessages({
      lines,
      clubName: "c",
      qrImageUrl: "https://cdn/qr.png",
    });

    // 25 mentions → 2 text chunks (20 + 5) + 1 image = 3 messages, no overflow.
    expect(overflow).toBe(false);
    expect(messages).toHaveLength(3);
    const [m0, m1, m2] = messages as [LineTextV2Message, LineTextV2Message, unknown];

    expect(m0.text.startsWith("ค่าก๊วน")).toBe(true); // header on first only
    expect(m1.text.startsWith("ค่าก๊วน")).toBe(false);
    // continuous numbering: chunk 2 opens at line 21 (per-message key resets to m0)
    expect(m1.text.startsWith("21. {m0} 100")).toBe(true);
    expect(m1.substitution!.m0.mentionee.userId).toBe("U20");
    // scan prompt trails the LAST text message, right before the QR image
    expect(m1.text.endsWith("สแกน QR ด้านล่างจ่ายได้เลย 🙏")).toBe(true);
    expect((m2 as { type: string }).type).toBe("image");
    // each message keeps within the 20-mention cap
    for (const m of messages) {
      if (m.type === "textV2") expect(Object.keys(m.substitution ?? {}).length).toBeLessThanOrEqual(20);
    }
  });

  it("plain-name lines do NOT consume the 20-mention budget (all 20 mentions in the first message)", () => {
    // 20 mentioned + 15 plain = 35 lines, under the 40-line cap → one message.
    const players: GroupBillPlayer[] = [
      ...Array.from({ length: 20 }, (_, i) => ({
        playerId: `L${i}`,
        displayName: `L${i}`,
        lineUserId: `U${i}`,
        amount: 100,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        playerId: `G${i}`,
        displayName: `G${i}`,
        lineUserId: null,
        amount: 100,
      })),
    ];
    const lines = buildGroupBillLines(players);
    const { messages, overflow } = buildGroupBillListMessages({
      lines,
      clubName: "c",
      qrImageUrl: null,
    });
    expect(overflow).toBe(false);
    expect(messages).toHaveLength(1);
    const t = messages[0] as LineTextV2Message;
    expect(Object.keys(t.substitution!)).toHaveLength(20); // all 20 mentions, guests didn't force a split
    expect(t.text).toContain("35. G14 100"); // last line numbered 35
  });

  it("splits a guest-heavy roster on the total-lines cap so no single message goes oversized", () => {
    // 100 plain guests, zero mentions → the 20-mention cap never trips; only the
    // 40-line cap keeps each message a safe size (LINE ~5000-char text limit).
    const guests: GroupBillPlayer[] = Array.from({ length: 100 }, (_, i) => ({
      playerId: `G${i}`,
      displayName: `Guest${i}`,
      lineUserId: null,
      amount: 100,
    }));
    const lines = buildGroupBillLines(guests);
    const { messages, overflow, sentPlayerIds } = buildGroupBillListMessages({
      lines,
      clubName: "c",
      qrImageUrl: null,
    });
    // 100 lines / 40 per chunk = 3 text messages (40 + 40 + 20), all within the push cap.
    expect(messages).toHaveLength(3);
    expect(overflow).toBe(false);
    expect(sentPlayerIds).toHaveLength(100);
    for (const m of messages) {
      if (m.type === "textV2") {
        expect(m.text.split("\n").filter((l) => /^\d+\./.test(l)).length).toBeLessThanOrEqual(40);
      }
    }
  });

  it("clamps to 5 messages, keeping the QR and dropping excess TEXT chunks", () => {
    const many: GroupBillPlayer[] = Array.from({ length: 85 }, (_, i) => ({
      playerId: `p${i}`,
      displayName: `u${i}`,
      lineUserId: `U${i}`,
      amount: 120,
    }));
    const lines = buildGroupBillLines(many);
    const { messages, overflow, sentPlayerIds } = buildGroupBillListMessages({
      lines,
      clubName: "c",
      qrImageUrl: "https://cdn/qr.png",
    });
    // 85 mentions → 5 text chunks (20×4 + 5) + 1 image = 6 → clamp to 5: keep 4 text + the QR.
    expect(messages).toHaveLength(5);
    expect(overflow).toBe(true);
    // QR is delivery-critical → it survives; the excess text chunk is what's dropped.
    expect(messages[messages.length - 1]).toEqual({
      type: "image",
      originalContentUrl: "https://cdn/qr.png",
      previewImageUrl: "https://cdn/qr.png",
    });
    const textMsgs = messages.filter((m) => m.type === "textV2") as LineTextV2Message[];
    expect(textMsgs).toHaveLength(4);
    // The scan prompt must ride the LAST KEPT text chunk (chunk 4), not the dropped
    // 5th chunk — otherwise the QR ships with no caption on every overflow push.
    expect(textMsgs[textMsgs.length - 1].text.endsWith(GROUP_BILL_SCAN_PROMPT)).toBe(true);
    // Only the 80 players whose line was actually sent are reported → the caller
    // stamps exactly these, so the 5 dropped players are never marked billed.
    expect(sentPlayerIds).toHaveLength(80);
    expect(sentPlayerIds).not.toContain("p84"); // 85th player (index 84) was dropped
  });

  it("returns no messages for an empty list", () => {
    const { messages, overflow } = buildGroupBillListMessages({
      lines: [],
      clubName: "c",
      qrImageUrl: "https://cdn/qr.png",
    });
    expect(messages).toHaveLength(0);
    expect(overflow).toBe(false);
  });
});
