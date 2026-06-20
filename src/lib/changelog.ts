export type ChangelogGroupType = "new" | "improved" | "fixed";

export type ChangelogGroup = {
  type: ChangelogGroupType;
  items: string[];
};

export type ChangelogEntry = {
  date: string; // "YYYY-MM-DD"
  groups: ChangelogGroup[];
};

/**
 * Single source of truth for the What's New page.
 * Items are written in Thai (intentionally kept Thai — same convention as
 * audit_logs.description and LINE notification bodies in this project).
 * Newest entry first.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-06-21",
    groups: [
      {
        type: "new",
        items: [
          "ตั้งค่ายืนยันสลิปจ่ายเงินได้รายก๊วน — แต่ละก๊วนเลือกเองได้ว่าจะตรวจสลิปแบบไหน",
          "ยืนยันเอง (ค่าเริ่มต้น) — ผู้เล่นส่งสลิป แล้วเจ้าของก๊วนกดยืนยัน",
          "ใช้กุญแจของก๊วนเอง — สมัครบริการตรวจสลิป (SlipOK / EasySlip) แล้วใส่กุญแจในหน้าตั้งค่า → ระบบตรวจและยืนยันให้อัตโนมัติ",
          "กุญแจเก็บแบบปลอดภัย ไม่แสดงค่าจริงในหน้าเว็บ (โชว์แค่ว่า \"ตั้งแล้ว\")",
          "ล็อกอินอัตโนมัติเมื่อเปิดผ่านแอป LINE — เปิดเว็บในแอป LINE แล้วเข้าสู่ระบบเป็นบัญชี LINE นั้นทันที ไม่ต้องกดปุ่มล็อกอิน (ถ้าเปิดนอก LINE ใช้ปุ่มล็อกอินเดิมตามปกติ)",
        ],
      },
      {
        type: "improved",
        items: [
          "ยกเลิก \"คีย์กลาง\" ตรวจสลิปแบบเดิม เปลี่ยนเป็นกุญแจของแต่ละก๊วน — ตรวจแม่นยำขึ้นเพราะผูกกับบัญชีรับเงินของก๊วนเอง",
        ],
      },
    ],
  },
  {
    date: "2026-06-19",
    groups: [
      {
        type: "new",
        items: [
          "เก็บเงินก๊วนผ่าน LINE อัตโนมัติ — เจ้าของกดปุ่มเดียว บอท LINE ส่งบิล (พร้อม QR พร้อมเพย์ที่ฝังยอดไว้แล้ว) ให้ผู้เล่นที่ผูก LINE ทุกคนที่ยังไม่จ่าย",
          "ผู้เล่นส่งสลิปกลับในแชต → ระบบตรวจแล้วติ๊ก \"จ่ายแล้ว\" ให้อัตโนมัติ",
          "สลิปที่ตรวจไม่ชัด → เข้าคิวให้เจ้าของกดยืนยัน/ปฏิเสธเอง",
          "ผู้เล่นที่ไม่มี LINE → ใช้สลิป QR แบบแชร์เหมือนเดิม",
        ],
      },
    ],
  },
];
