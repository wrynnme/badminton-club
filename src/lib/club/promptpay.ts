// PromptPay QR payload (EMVCo) — pure, testable, no dependency.
// Builds the data string for a Thai PromptPay QR; render it with any QR component
// (e.g. react-qr-code) by passing the returned string as `value`. Embedding an
// amount produces a DYNAMIC QR so the bank app pre-fills the amount on scan.
// Spec: EMVCo TLV + CRC-16/CCITT-FALSE; PromptPay AID A000000677010111.

const AID = "A000000677010111"; // PromptPay Application ID (sub-tag 00 of merchant tag 29)
const ID_MOBILE = "01";
const ID_NATIONAL = "02";
const ID_EWALLET = "03";

/** Keep digits only (strips spaces / dashes / parens from a typed proxy id). */
function digits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/** EMVCo TLV field: 2-char id + 2-digit length + value. */
function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection) over the ASCII
 * bytes, as 4 upper-case hex chars. Canonical check: crc16ccitt("123456789") === "29B1".
 */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export type PromptPayType = "mobile" | "national_id" | "ewallet";

/** Classify a PromptPay proxy id by digit count (mobile 10 / national id 13 / e-wallet 15). */
export function detectPromptPayType(id: string): PromptPayType | null {
  const d = digits(id);
  if (d.length === 10) return "mobile";
  if (d.length === 13) return "national_id";
  if (d.length === 15) return "ewallet";
  return null;
}

/** True when `id` is a usable PromptPay proxy. */
export function isValidPromptPayId(id: string): boolean {
  return detectPromptPayType(id) !== null;
}

/** Format the proxy value: mobile → 13-digit "0066…"; national id / e-wallet → verbatim. */
function formatTarget(d: string): string {
  if (d.length >= 13) return d;
  // mobile: drop leading 0, prefix country code 66, left-pad to 13
  return ("0000000000000" + d.replace(/^0/, "66")).slice(-13);
}

/**
 * Build the PromptPay QR payload string. `amount` (baht) > 0 embeds a transaction
 * amount → DYNAMIC QR (bank app pre-fills it); omit / 0 → static reusable QR.
 * Returns "" for an invalid id — callers should guard with `isValidPromptPayId`.
 */
export function buildPromptPayPayload(id: string, amount?: number): string {
  const type = detectPromptPayType(id);
  if (!type) return "";
  const d = digits(id);
  const proxyTag =
    type === "mobile" ? ID_MOBILE : type === "national_id" ? ID_NATIONAL : ID_EWALLET;

  const merchant = tlv("29", tlv("00", AID) + tlv(proxyTag, formatTarget(d)));
  const hasAmount = typeof amount === "number" && Number.isFinite(amount) && amount > 0;

  let payload =
    tlv("00", "01") + // payload format indicator
    tlv("01", hasAmount ? "12" : "11") + // point of initiation: 12 dynamic / 11 static
    merchant +
    tlv("53", "764") + // currency THB
    (hasAmount ? tlv("54", amount.toFixed(2)) : "") + // transaction amount
    tlv("58", "TH"); // country code

  payload += "6304"; // CRC tag (63) + length (04); CRC is computed over this prefix too
  return payload + crc16ccitt(payload);
}
