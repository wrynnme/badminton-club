import { describe, it, expect } from "vitest";
import { parseLineSignup } from "@/lib/club/line-signup";

// ---------------------------------------------------------------------------
// Real-world fixture 1 (original — verbatim from brief)
// ---------------------------------------------------------------------------
const FIXTURE = `ลงชื่อ ตีแบด🏸
🗓️: วันพุธ 10 มิย 26
📍สนาม : BBW
⏰เวลา : 19.00-21.00
1. BOYY
2. BOWW
3. @beeeeee
4. @phppim
5. โจ้
6. เต้
7. ผึ้ง
8. อาท*
9. โส (ท็อป)
10. กวาง (ท็อป)
11. K.
12. โอม
13. James
14. คลื่น
15. ซัน (มัส)
16. บีน (มัส)
17. ออมสิน (มัส)
18. มุมิล (มัส)
19. อุ้ย (มัส)
20. มัสสึ
21. พี่
22. เจ
23. เจ2 (ต้าน)
24. เจ3 (วอ)
25. ออย* N
26.พี่โอ้ต🍺
27.ท้อ🍺
28. นัท🍺
29. จอย 🍺
30. อ้าย
31. Noey
32. top
33. กอฟ
34. เอิท @PHANU CHS.
35. ปาล์ม
36. ภูมิ

❌❌ปิด❌❌
สำรอง
เกอร์*
เจ4 (มังกร)
เต้ย

ค่าสนาม หารเท่า
เกมละ 21 บาท
*ใส่เสื้อก๊วน เกมละ 20 บาท*

@All    มาครับ พุธ
BBW 4-5-6-7-8 ไม่กำหนดตายตัวว่า format จะเป็นแบบไหน`;

describe("parseLineSignup — real-world fixture 1", () => {
  const { players, reserves } = parseLineSignup(FIXTURE);

  it("extracts exactly 36 main players", () => {
    expect(players).toHaveLength(36);
  });

  it("players[0].name is BOYY", () => {
    expect(players[0].name).toBe("BOYY");
  });

  it("players[35].name is ภูมิ", () => {
    expect(players[35].name).toBe("ภูมิ");
  });

  it("strips leading @ from @beeeeee", () => {
    expect(players.map((p) => p.name)).toContain("beeeeee");
  });

  it("strips leading @ from @phppim", () => {
    expect(players.map((p) => p.name)).toContain("phppim");
  });

  it("keeps inline @ in เอิท @PHANU CHS.", () => {
    expect(players.map((p) => p.name)).toContain("เอิท @PHANU CHS.");
  });

  it("handles no-space-after-dot: พี่โอ้ต🍺", () => {
    expect(players.map((p) => p.name)).toContain("พี่โอ้ต🍺");
  });

  it("handles no-space-after-dot: ท้อ🍺", () => {
    expect(players.map((p) => p.name)).toContain("ท้อ🍺");
  });

  it("extracts exactly 3 reserves in order", () => {
    expect(reserves.map((r) => r.name)).toEqual(["เกอร์*", "เจ4 (มังกร)", "เต้ย"]);
  });

  it("all fixture-1 players have null start_time (no time windows in this fixture)", () => {
    for (const p of players) expect(p.start_time).toBeNull();
  });

  it("all fixture-1 reserves have null start_time", () => {
    for (const r of reserves) expect(r.start_time).toBeNull();
  });

  it("no player name contains ค่าสนาม", () => {
    for (const p of players) expect(p.name).not.toContain("ค่าสนาม");
  });

  it("no player name contains เกมละ", () => {
    for (const p of players) expect(p.name).not.toContain("เกมละ");
  });

  it("no player name contains @All", () => {
    for (const p of players) expect(p.name).not.toContain("@All");
  });

  it("no reserve name contains ค่าสนาม", () => {
    for (const r of reserves) expect(r.name).not.toContain("ค่าสนาม");
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture 2 — per-player time windows (verbatim from brief)
// ---------------------------------------------------------------------------
const FIXTURE2 = `ลงชื่อ ตีแบด🏸
🗓️: วันเสาร์ 13 มิย 26
📍สนาม : BBW
⏰เวลา : 18.00-21.00
1. BOYY
2. BOWW
3. บี แป้ง 19:00-21:00
4. แป้ง บี 19:00-21:00
5. ปาล์ม
6. ป๊อก 18.00-20.00
7.  NON 19.00-21.00
8. อิฟฟุ
9. Nine 19:00-21:00
10. Nanana
11. Earth
12. คีน
13. บุ๋ม* BG
14. แพรว* BG
15. เนย* N
16. อาร์ม* N
17.  Phoon 18:00-20:00
18. Luck 19.00-21.00
19. แทน* N
20. เหนือ
21. Rupjeet* ต่างชาติ
22.
23. เจ
24. เจ2 (ต้าน)
25. เจ3 (ทู)
26. เจ4 (วิน)
27. มังกร (19.00-21.00)
28. เฟิร์ส
29. เต๋า
30. ไอซ์
31. อัญ
32.
33. กอฟๆ
34.
35.
36.
37.James
38. เฟรม

❌❌ปิด❌❌
สำรอง


(ใครสะดวกเล่นเวลาไหนให้แจ้งด้วยนะครับ จะได้จองคอร์ทได้ถูก)

ใส่เสื้อก๊วนมา ลด เกมละ 1 บาท
ใส่ตีเกมแรก

ค่าสนาม หารเท่า
เกมละ 21 บาท

@All    มาครับ วันเสาร์ บางคนมีกำหนดเวลาไว้หลังชื่อแล้ว`;

describe("parseLineSignup — real-world fixture 2 (per-player time windows)", () => {
  const { players, reserves } = parseLineSignup(FIXTURE2);

  it("extracts exactly 33 main players (22/32/34/35/36 skipped as empty)", () => {
    expect(players).toHaveLength(33);
  });

  it("reserves is empty (blank line immediately after สำรอง terminates section)", () => {
    expect(reserves).toHaveLength(0);
  });

  // --- Name extraction spot-checks ---

  it("บี แป้ง stripped of time window → name only", () => {
    const row = players.find((p) => p.name === "บี แป้ง");
    expect(row).toBeDefined();
  });

  it("บี แป้ง has start_time 19:00 and end_time 21:00", () => {
    const row = players.find((p) => p.name === "บี แป้ง");
    expect(row?.start_time).toBe("19:00");
    expect(row?.end_time).toBe("21:00");
  });

  it("ป๊อก stripped of dot-notation time window", () => {
    const row = players.find((p) => p.name === "ป๊อก");
    expect(row?.start_time).toBe("18:00");
    expect(row?.end_time).toBe("20:00");
  });

  it("NON has start_time 19:00 end_time 21:00 (dot notation)", () => {
    const row = players.find((p) => p.name === "NON");
    expect(row?.start_time).toBe("19:00");
    expect(row?.end_time).toBe("21:00");
  });

  it("Nine has start_time 19:00 end_time 21:00 (colon notation)", () => {
    const row = players.find((p) => p.name === "Nine");
    expect(row?.start_time).toBe("19:00");
    expect(row?.end_time).toBe("21:00");
  });

  it("Phoon has start_time 18:00 end_time 20:00", () => {
    const row = players.find((p) => p.name === "Phoon");
    expect(row?.start_time).toBe("18:00");
    expect(row?.end_time).toBe("20:00");
  });

  it("Luck has start_time 19:00 end_time 21:00 (dot notation)", () => {
    const row = players.find((p) => p.name === "Luck");
    expect(row?.start_time).toBe("19:00");
    expect(row?.end_time).toBe("21:00");
  });

  it("มังกร extracted from parenthesised time (19.00-21.00)", () => {
    const row = players.find((p) => p.name === "มังกร");
    expect(row?.start_time).toBe("19:00");
    expect(row?.end_time).toBe("21:00");
  });

  it("เจ2 (ต้าน) — non-time parens stay in name, no time extracted", () => {
    const row = players.find((p) => p.name === "เจ2 (ต้าน)");
    expect(row).toBeDefined();
    expect(row?.start_time).toBeNull();
    expect(row?.end_time).toBeNull();
  });

  it("James parsed from 37.James (no space after dot)", () => {
    expect(players.map((p) => p.name)).toContain("James");
  });

  it("บุ๋ม* BG — no time extracted, name kept whole", () => {
    const row = players.find((p) => p.name === "บุ๋ม* BG");
    expect(row).toBeDefined();
    expect(row?.start_time).toBeNull();
  });

  it("Rupjeet* ต่างชาติ — no time extracted", () => {
    const row = players.find((p) => p.name === "Rupjeet* ต่างชาติ");
    expect(row).toBeDefined();
    expect(row?.start_time).toBeNull();
  });

  // --- Footer / note lines must NOT appear as players ---

  it("no player name contains ใครสะดวก", () => {
    for (const p of players) expect(p.name).not.toContain("ใครสะดวก");
  });

  it("no player name contains ค่าสนาม", () => {
    for (const p of players) expect(p.name).not.toContain("ค่าสนาม");
  });

  it("no player name contains เกมละ", () => {
    for (const p of players) expect(p.name).not.toContain("เกมละ");
  });

  it("no player name contains @All", () => {
    for (const p of players) expect(p.name).not.toContain("@All");
  });

  it("no player name contains ใส่เสื้อก๊วน", () => {
    for (const p of players) expect(p.name).not.toContain("ใส่เสื้อก๊วน");
  });
});

// ---------------------------------------------------------------------------
// Unit cases — time extractor
// ---------------------------------------------------------------------------
describe("parseLineSignup — time extractor unit cases", () => {
  function parse1(line: string) {
    const { players } = parseLineSignup(`1. ${line}`);
    return players[0] ?? null;
  }

  it("18.00-20.00 (dot notation) → 18:00 / 20:00", () => {
    const r = parse1("TestName 18.00-20.00");
    expect(r?.start_time).toBe("18:00");
    expect(r?.end_time).toBe("20:00");
    expect(r?.name).toBe("TestName");
  });

  it("19:00-21:00 (colon notation) → 19:00 / 21:00", () => {
    const r = parse1("TestName 19:00-21:00");
    expect(r?.start_time).toBe("19:00");
    expect(r?.end_time).toBe("21:00");
  });

  it("(19.00-21.00) parenthesised → 19:00 / 21:00, parens stripped", () => {
    const r = parse1("TestName (19.00-21.00)");
    expect(r?.start_time).toBe("19:00");
    expect(r?.end_time).toBe("21:00");
    expect(r?.name).toBe("TestName");
  });

  it("9.00-12.00 → zero-padded 09:00 / 12:00", () => {
    const r = parse1("TestName 9.00-12.00");
    expect(r?.start_time).toBe("09:00");
    expect(r?.end_time).toBe("12:00");
  });

  it("non-time parens like (ท็อป) untouched — name intact, no time", () => {
    const r = parse1("กวาง (ท็อป)");
    expect(r?.name).toBe("กวาง (ท็อป)");
    expect(r?.start_time).toBeNull();
  });

  it("non-time parens like (ต้าน) untouched", () => {
    const r = parse1("เจ2 (ต้าน)");
    expect(r?.name).toBe("เจ2 (ต้าน)");
    expect(r?.start_time).toBeNull();
  });

  it("time in the MIDDLE of a name is NOT extracted (only trailing)", () => {
    // The time appears before a trailing word — not at end → not extracted
    const r = parse1("A 19:00-21:00 B");
    expect(r?.name).toBe("A 19:00-21:00 B");
    expect(r?.start_time).toBeNull();
  });

  it("no time present → both times null", () => {
    const r = parse1("ปาล์ม");
    expect(r?.start_time).toBeNull();
    expect(r?.end_time).toBeNull();
    expect(r?.name).toBe("ปาล์ม");
  });

  it("en-dash separator (–) is accepted", () => {
    const r = parse1("TestName 18:00–21:00");
    expect(r?.start_time).toBe("18:00");
    expect(r?.end_time).toBe("21:00");
  });

  it("mixed notation start dot / end colon (18.00-21:00)", () => {
    // Each side parsed independently by its separator — 18.00 → 18:00
    const r = parse1("TestName 18.00-21:00");
    expect(r?.start_time).toBe("18:00");
    expect(r?.end_time).toBe("21:00");
  });
});

// ---------------------------------------------------------------------------
// Edge cases (existing suite updated to new object shape)
// ---------------------------------------------------------------------------
describe("parseLineSignup — edge cases", () => {
  it("empty string → both []", () => {
    expect(parseLineSignup("")).toEqual({ players: [], reserves: [] });
  });

  it("whitespace-only string → both []", () => {
    expect(parseLineSignup("   \n  \n")).toEqual({ players: [], reserves: [] });
  });

  it("supports ) delimiter (1) style)", () => {
    const { players } = parseLineSignup("1) Alice\n2) Bob");
    expect(players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("supports . delimiter with no space after dot (26.Name)", () => {
    const { players } = parseLineSignup("1.Alpha\n2.Beta");
    expect(players.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
  });

  it("skips numbered lines with empty name", () => {
    const { players } = parseLineSignup("1. \n2. Alice");
    expect(players.map((p) => p.name)).toEqual(["Alice"]);
  });

  it("no สำรอง section → reserves []", () => {
    const { reserves } = parseLineSignup("1. ก\n2. ข");
    expect(reserves).toEqual([]);
  });

  it("สำรอง section ending at end-of-text (no blank line) captures all reserves", () => {
    const text = "1. ก\nสำรอง\nX\nY";
    const { players, reserves } = parseLineSignup(text);
    expect(players.map((p) => p.name)).toEqual(["ก"]);
    expect(reserves.map((r) => r.name)).toEqual(["X", "Y"]);
  });

  it("reserve section stops at whitespace-only line", () => {
    const text = "1. ก\nสำรอง\nX\n \nY อีกคน";
    const { reserves } = parseLineSignup(text);
    // single-space line terminates reserves; Y อีกคน should NOT appear
    expect(reserves.map((r) => r.name)).toEqual(["X"]);
  });

  it("lines with ❌ are ignored and do not break mode", () => {
    const { players } = parseLineSignup("1. ก\n❌❌ปิด❌❌\n2. ข");
    expect(players.map((p) => p.name)).toEqual(["ก", "ข"]);
  });

  it("duplicate names are preserved (dedup is caller's job)", () => {
    const { players } = parseLineSignup("1. ก\n2. ก\n3. ข");
    expect(players.map((p) => p.name)).toEqual(["ก", "ก", "ข"]);
  });

  it("clamps name to 60 chars", () => {
    const longName = "A".repeat(70);
    const { players } = parseLineSignup(`1. ${longName}`);
    expect(players[0].name).toHaveLength(60);
  });

  it("clamps the name AFTER extracting time (long name + trailing time keeps time)", () => {
    const name = "A".repeat(56);
    const { players } = parseLineSignup(`1. ${name} 19:00-21:00`);
    // time must survive even though raw cell (56 + 12) exceeds the 60 clamp
    expect(players[0].start_time).toBe("19:00");
    expect(players[0].end_time).toBe("21:00");
    expect(players[0].name).toBe(name);
  });

  it("collapses internal whitespace to single space", () => {
    const { players } = parseLineSignup("1. โส   (ท็อป)");
    expect(players[0].name).toBe("โส (ท็อป)");
  });

  it("header lines (no number prefix) are ignored", () => {
    const { players } = parseLineSignup(
      "ลงชื่อ ตีแบด\n🗓️ วันพุธ\n1. ก\n2. ข"
    );
    expect(players.map((p) => p.name)).toEqual(["ก", "ข"]);
  });

  it("three-digit numbers supported", () => {
    const lines = Array.from(
      { length: 100 },
      (_, i) => `${i + 1}. P${i + 1}`
    ).join("\n");
    const { players } = parseLineSignup(lines);
    expect(players).toHaveLength(100);
    expect(players[99].name).toBe("P100");
  });

  // Space-separator format ("1 Kevin" with no dot/paren)
  it("supports space separator (1 Kevin style)", () => {
    const { players } = parseLineSignup("1 Kevin\n2 nest\n3 pop");
    expect(players.map((p) => p.name)).toEqual(["Kevin", "nest", "pop"]);
  });

  it("space separator: keeps trailing markers (20 โม OP**)", () => {
    const { players } = parseLineSignup("20 โม OP**");
    expect(players[0].name).toBe("โม OP**");
  });

  it("space separator + trailing time (1 Kevin 19:00-21:00)", () => {
    const { players } = parseLineSignup("1 Kevin 19:00-21:00");
    expect(players[0].name).toBe("Kevin");
    expect(players[0].start_time).toBe("19:00");
    expect(players[0].end_time).toBe("21:00");
  });

  it("space separator + dot-notation time + Thai name (6 ป๊อก 18.00-20.00)", () => {
    const { players } = parseLineSignup("6 ป๊อก 18.00-20.00");
    expect(players[0].name).toBe("ป๊อก");
    expect(players[0].start_time).toBe("18:00");
    expect(players[0].end_time).toBe("20:00");
  });

  it("space separator + parenthesised time (27 มังกร (19.00-21.00))", () => {
    const { players } = parseLineSignup("27 มังกร (19.00-21.00)");
    expect(players[0].name).toBe("มังกร");
    expect(players[0].start_time).toBe("19:00");
    expect(players[0].end_time).toBe("21:00");
  });

  it("space separator + multi-word name + time (3 บี แป้ง 19:00-21:00)", () => {
    const { players } = parseLineSignup("3 บี แป้ง 19:00-21:00");
    expect(players[0].name).toBe("บี แป้ง");
    expect(players[0].start_time).toBe("19:00");
    expect(players[0].end_time).toBe("21:00");
  });

  it("space separator: skips number-only line (22 )", () => {
    const { players } = parseLineSignup("21 PK\n22 \n23 เจ");
    expect(players.map((p) => p.name)).toEqual(["PK", "เจ"]);
  });

  it("Thai-leading header line is not captured as a numbered entry", () => {
    // "เวลา 19.00-21.00 น." starts with Thai, not a digit → ignored
    const { players } = parseLineSignup("เวลา 19.00-21.00 น.\n1 Kevin");
    expect(players.map((p) => p.name)).toEqual(["Kevin"]);
  });

  it("mid-line number in a header is not captured (จอง 3 สนาม)", () => {
    const { players } = parseLineSignup("จอง 3 สนาม 5,6,7\n1 Kevin");
    expect(players.map((p) => p.name)).toEqual(["Kevin"]);
  });

  it("emoji-leading header with inline number not captured (Max 20 คน)", () => {
    const { players } = parseLineSignup('☀️ บอม ☀️ "Max 20 คน"\n1 Kevin');
    expect(players.map((p) => p.name)).toEqual(["Kevin"]);
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture 3 — space-separator roster (DADDY HOUSE, verbatim)
// ---------------------------------------------------------------------------
const FIXTURE3 = `🌀 ลงชื่อ ( ศุกร์ 12/6 )
☀️ก๊วน DADDY HOUSE☀️
เปิดลงชื่อตีแบด สนาม BROTHER

🌀 ++ วันศุกร์ ++🌀
เวลา 19.00-21.00 น.
จอง 3 สนาม 5,6,7

🎯 ซอย ข้างชลชาย
ปักโลเคชั่นมาตามนี้
https://maps.app.goo.gl/oCJrc8pKubLuR1V79
================
☀️ บอม ☀️ "Max 20 คน"
1 Kevin
2 nest
3 pop
4 benz
5 นิ
6 กอล์ฟ
7 babo
8 กบ
9 Ton
10 botanicia
11 pae
12 ก้าว
13 บลู
14 แจ๊บ
15 อาย
16 nnnn
17 ตั้ม
18 pppp
19 เกิด
20 โม OP**
21 PK
================
🔥ลงชื่อได้ทันที...วันนี้

สำรอง
Cc
เอ
จิม`;

describe("parseLineSignup — real-world fixture 3 (space separator)", () => {
  const { players, reserves } = parseLineSignup(FIXTURE3);

  it("extracts exactly 21 main players", () => {
    expect(players).toHaveLength(21);
  });

  it("player order is correct", () => {
    expect(players.map((p) => p.name)).toEqual([
      "Kevin", "nest", "pop", "benz", "นิ", "กอล์ฟ", "babo", "กบ", "Ton",
      "botanicia", "pae", "ก้าว", "บลู", "แจ๊บ", "อาย", "nnnn", "ตั้ม",
      "pppp", "เกิด", "โม OP**", "PK",
    ]);
  });

  it("extracts exactly 3 reserves (Cc, เอ, จิม)", () => {
    expect(reserves.map((r) => r.name)).toEqual(["Cc", "เอ", "จิม"]);
  });

  it("no time windows in this fixture", () => {
    for (const p of players) expect(p.start_time).toBeNull();
  });

  it("header / venue / url / separator lines are not captured", () => {
    const names = players.map((p) => p.name).join("|");
    expect(names).not.toContain("DADDY");
    expect(names).not.toContain("BROTHER");
    expect(names).not.toContain("สนาม");
    expect(names).not.toContain("คน");
    expect(names).not.toContain("maps");
    expect(names).not.toContain("=");
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture 4 — empty numbered reserve slots + asterisk-ปิด (verbatim)
// ---------------------------------------------------------------------------
const FIXTURE4 = `🏸ตีกัน...วันอาทิตย์🌞
🗓️ 14 มิถุนายน 2569
⏰ 18.00 - 21.00 น.
****************************
สนาม ทัศนาฯ
คอร์ท X
****************************
1.โจ้
2.วาวา
3.กอล์ฟ
4.ต๊ะ
5.โน๊ต
6.เกมส์
7.ตั้ม
8.นัย
9.ม่อน
10.กาโม่ (18.00-20.00)
11.โรเจอร์ (18.00-20.00)
12.พี
13.ปาม
14.

สำรอง
15.
16.
17.
18.
19.
20.
***********ปิด***********`;

describe("parseLineSignup — real-world fixture 4 (empty reserve slots + asterisk-ปิด)", () => {
  const { players, reserves } = parseLineSignup(FIXTURE4);

  it("extracts exactly 13 main players (14. empty slot skipped)", () => {
    expect(players).toHaveLength(13);
  });

  it("player order is correct", () => {
    expect(players.map((p) => p.name)).toEqual([
      "โจ้", "วาวา", "กอล์ฟ", "ต๊ะ", "โน๊ต", "เกมส์", "ตั้ม", "นัย",
      "ม่อน", "กาโม่", "โรเจอร์", "พี", "ปาม",
    ]);
  });

  it("กาโม่ has parenthesised time 18:00-20:00", () => {
    const p = players.find((x) => x.name === "กาโม่");
    expect(p?.start_time).toBe("18:00");
    expect(p?.end_time).toBe("20:00");
  });

  it("โรเจอร์ has parenthesised time 18:00-20:00", () => {
    const p = players.find((x) => x.name === "โรเจอร์");
    expect(p?.start_time).toBe("18:00");
    expect(p?.end_time).toBe("20:00");
  });

  it("empty numbered reserve slots (15.-20.) produce zero reserves", () => {
    expect(reserves).toHaveLength(0);
  });

  it("asterisk-wrapped ปิด is not captured as a reserve name", () => {
    expect(reserves.map((r) => r.name).join("|")).not.toContain("ปิด");
  });
});

// ---------------------------------------------------------------------------
// Unit cases — close-marker decoration + numbered reserves
// ---------------------------------------------------------------------------
describe("parseLineSignup — close marker & numbered reserves", () => {
  it("asterisk-wrapped ปิด is a close marker (***ปิด***)", () => {
    const { players } = parseLineSignup("1. ก\n***ปิด***\n2. ข");
    expect(players.map((p) => p.name)).toEqual(["ก", "ข"]);
  });

  it("equals-wrapped ปิด is a close marker (===ปิด===)", () => {
    const { players } = parseLineSignup("1. ก\n===ปิด===\n2. ข");
    expect(players.map((p) => p.name)).toEqual(["ก", "ข"]);
  });

  it("empty numbered reserve slot is skipped (15.)", () => {
    const { reserves } = parseLineSignup("1. ก\nสำรอง\n15.\n16.");
    expect(reserves).toHaveLength(0);
  });

  it("numbered reserve WITH a name is kept (15. แอน)", () => {
    const { reserves } = parseLineSignup("1. ก\nสำรอง\n15. แอน\n16.");
    expect(reserves.map((r) => r.name)).toEqual(["แอน"]);
  });

  it("plain-name reserves still work alongside numbered ones", () => {
    const { reserves } = parseLineSignup("1. ก\nสำรอง\nเอ\n15.\nจิม");
    expect(reserves.map((r) => r.name)).toEqual(["เอ", "จิม"]);
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture 5 — schedule-note footer that looks numbered (verbatim)
// ---------------------------------------------------------------------------
const FIXTURE5 = `🏸ลงชื่อตีแบด อังคาร 26ที่ พค 🏸
         ⏰19.00-22.00 BBW🏟️

1.พี่โจ้
2.หนูนัน
3.เอร์ทหิว
4.เฟม
5.ต้อมนุ่ม💩
6.แม็พเอ๋อ
7.
8.ทีม
9.ดิว
10.เบ็น
11.เอิร์ท(ทีม)
12.นุ้คนิ้กมาปราบหนูนัน
13.SONGKRAN
14.พี่บอลทามะ
15.โด้ M
16.พี่ท๊อป เดินเรือ
17.S
18. เจน จะกินส้มตำ
19.ปปลาเลิก3ทุ่ม
20.ไฟท์
21.แจ๊บ
22.P
23.เกมส์(19.00-21.00)
24.พี่เล็ก 2

     ปิดค้าบบผม  ❌❌❌❌❌

19.00 = 8-9-10
20.00= 7-8-9-10 `;

describe("parseLineSignup — real-world fixture 5 (schedule-note footer)", () => {
  const { players, reserves } = parseLineSignup(FIXTURE5);

  it("extracts exactly 23 main players (7. empty skipped)", () => {
    expect(players).toHaveLength(23);
  });

  it("schedule-note footers (19.00 = 8-9-10) are not captured as players", () => {
    const names = players.map((p) => p.name).join("|");
    expect(names).not.toContain("8-9-10");
    expect(names).not.toContain("=");
  });

  it("เกมส์ keeps its inline time 19:00-21:00", () => {
    const p = players.find((x) => x.name === "เกมส์");
    expect(p?.start_time).toBe("19:00");
    expect(p?.end_time).toBe("21:00");
  });

  it("non-time parenthetical (ทีม) stays in name (เอิร์ท(ทีม))", () => {
    expect(players.map((p) => p.name)).toContain("เอิร์ท(ทีม)");
  });

  it("inline note that isn't a time stays in name (ปปลาเลิก3ทุ่ม)", () => {
    expect(players.map((p) => p.name)).toContain("ปปลาเลิก3ทุ่ม");
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture 6 — session-time header that looks numbered (verbatim)
// ---------------------------------------------------------------------------
const FIXTURE6 = `วันจันทร์ที่ 8 มิย 69
บ้านไร่
21.00 - 23.00

1. พี่ท้อป
2. บี
3. แป้ง
4. นนท์
5.
6.`;

describe("parseLineSignup — real-world fixture 6 (session-time header line)", () => {
  const { players, reserves } = parseLineSignup(FIXTURE6);

  it("extracts exactly 4 players (5. and 6. empty skipped)", () => {
    expect(players.map((p) => p.name)).toEqual(["พี่ท้อป", "บี", "แป้ง", "นนท์"]);
  });

  it("session-time header (21.00 - 23.00) is not captured as a player", () => {
    expect(players.map((p) => p.name).join("|")).not.toContain("23.00");
  });

  it("no reserves", () => {
    expect(reserves).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture 7 — multi-session message (numbering resets per group,
// multiple ***ปิด*** markers between groups) (verbatim)
// ---------------------------------------------------------------------------
const FIXTURE7 = `📝ลงชื่อตีแบดกันนะครับทุกคน
🏸วันพุธที่ 10 มิถุนายน 2569
⏱เวลา 19:00-22.00 น.
__________________________

⏰19.00-21.00
1.
***ปิด***



⏰19.00-22.00
1.สัน
2.ตั้ม
3.แม็ค
4.กรุง
5.ตั้น
6.
7.
***ปิด***


⏰20.00-22.00
1.P
2.หนึ่ง
3.เพียว
4.บอย ท่าพระจันทร์
5.cooper🐈
6.จ๊อบ
7.แด๊ก
8.T
***ปิด***

__________________________
📍ทัศนา คอร์ท



🚨จองสนามไว้แล้ว
📝ช่วงนี้สนามเต็มเร็ว รบกวนรีบลงชื่อกันนะครับ

***พี่น้องคนไหนที่ติดธุระให้ถอนชื่อก่อน11.30วันที่เล่น หรือให้เพื่อนมาแทนน๊า หากไม่มีใครแทน  ขอให้ช่วยค่าคอดพี่ ๆ น้อง ๆ น๊า***`;

describe("parseLineSignup — real-world fixture 7 (multi-session, numbering resets)", () => {
  const { players, reserves } = parseLineSignup(FIXTURE7);

  it("merges all groups into 13 players (numbering resets, empties skipped)", () => {
    expect(players.map((p) => p.name)).toEqual([
      "สัน", "ตั้ม", "แม็ค", "กรุง", "ตั้น",
      "P", "หนึ่ง", "เพียว", "บอย ท่าพระจันทร์", "cooper🐈", "จ๊อบ", "แด๊ก", "T",
    ]);
  });

  it("multiple ***ปิด*** markers do not stop parsing later groups", () => {
    // group 3 (after the 2nd ปิด) must still be present
    expect(players.map((p) => p.name)).toContain("T");
  });

  it("⏰time-group headers are not captured as players", () => {
    const names = players.map((p) => p.name).join("|");
    expect(names).not.toContain("19.00");
    expect(names).not.toContain("20.00");
  });

  it("footer paragraph (***...***) and underscores are not captured", () => {
    const names = players.map((p) => p.name).join("|");
    expect(names).not.toContain("พี่น้อง");
    expect(names).not.toContain("_");
  });

  it("no reserves", () => {
    expect(reserves).toHaveLength(0);
  });
});
