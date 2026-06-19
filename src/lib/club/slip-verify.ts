/**
 * slip-verify.ts — provider-agnostic slip-verification adapter.
 *
 * `verifySlip` is the outbound adapter seam. Swap providers by setting
 *   SLIP_VERIFY_PROVIDER = "easyslip" | "slipok"
 *   SLIP_VERIFY_API_KEY  = <provider key>
 *
 * `matchSlipToBill` is a pure, side-effect-free decision function that maps a
 * SlipVerifyResult + bill parameters to a final verification outcome. It is
 * fully testable without network access.
 *
 * Required env vars (when a real provider is configured):
 *   SLIP_VERIFY_PROVIDER — "easyslip" | "slipok"
 *   SLIP_VERIFY_API_KEY  — provider API key
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlipVerifyResult = {
  ok: boolean;           // provider confirmed a real transaction
  amount?: number;       // THB amount on the slip
  receiverId?: string;   // receiver proxy/account (may be masked, e.g. last digits)
  receiverName?: string;
  transRef?: string;
  raw?: unknown;         // raw provider response
  reason?: string;       // when !ok: "not_configured" | "provider_error" | "invalid"
};

// ---------------------------------------------------------------------------
// verifySlip — adapter entry point
// ---------------------------------------------------------------------------

/**
 * Verify a payment slip against the configured provider.
 *
 * Input: either an `imageBuffer` (raw image bytes) or a `payload` string
 * (some providers accept base64 or a pre-processed payload).
 *
 * When no provider is configured both env vars are absent — returns
 * `{ ok: false, reason: "not_configured" }` immediately so callers can
 * fall through to `matchSlipToBill` which routes that to `"manual"`.
 */
export async function verifySlip(input: {
  imageBuffer?: Buffer;
  payload?: string;
}): Promise<SlipVerifyResult> {
  const provider = process.env.SLIP_VERIFY_PROVIDER;
  const apiKey = process.env.SLIP_VERIFY_API_KEY;

  if (!provider || !apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  // Clean swappable seam — add real implementation per provider below.
  switch (provider) {
    case "easyslip": {
      // TODO: implement provider call (fetch + API key)
      // POST https://api.easyslip.com/api/v1/verify
      // Authorization: Bearer <apiKey>
      // body: { image: input.imageBuffer?.toString("base64") }
      return { ok: false, reason: "not_configured" };
    }

    case "slipok": {
      // TODO: implement provider call (fetch + API key)
      // POST https://api.slipok.com/api/line/apikey/<apiKey>/verify
      // body: FormData with "files" field containing the image buffer
      return { ok: false, reason: "not_configured" };
    }

    default: {
      console.error("[SLIP-VERIFY] Unknown provider:", provider);
      return { ok: false, reason: "not_configured" };
    }
  }
}

// ---------------------------------------------------------------------------
// matchSlipToBill — pure decision function
// ---------------------------------------------------------------------------

/**
 * Decide whether a slip matches the outstanding bill.
 *
 * Decision priority:
 *  1. Provider could not verify → "manual" (verify_unavailable)
 *  2. Amount missing or mismatched (> 0.01 THB) → "manual" (amount_mismatch)
 *  3. Receiver check (lenient):
 *       - PASS if last-4 digits of proxy id match, OR
 *       - PASS if receiver name contains / is contained by club name (case-insensitive)
 *       - SKIP if both receiverId and receiverName are absent (don't penalise missing data)
 *       - FAIL → "manual" (receiver_mismatch) only when data is present but wrong
 *  4. All checks passed → "verified" (auto)
 *
 * This function is pure: no network calls, no DB writes, no env reads.
 */
export function matchSlipToBill(input: {
  detected: SlipVerifyResult;
  billAmount: number;
  clubPromptpayId: string | null;
  clubPromptpayName: string | null;
}): { result: "verified" | "manual"; reason: string } {
  const { detected, billAmount, clubPromptpayId, clubPromptpayName } = input;

  // 1. Provider did not confirm a real transaction.
  if (!detected.ok) {
    return { result: "manual", reason: "verify_unavailable" };
  }

  // 2. Amount check.
  if (
    detected.amount == null ||
    Math.abs(detected.amount - billAmount) > 0.01
  ) {
    return { result: "manual", reason: "amount_mismatch" };
  }

  // 3. Receiver check (only when the provider returned receiver data).
  const hasReceiverId = detected.receiverId != null && detected.receiverId !== "";
  const hasReceiverName =
    detected.receiverName != null && detected.receiverName !== "";

  if (hasReceiverId || hasReceiverName) {
    let receiverOk = false;

    // 3a. Compare last 4 digits of proxy id (strip non-digits from both).
    if (hasReceiverId && clubPromptpayId) {
      const detectedDigits = detected.receiverId!.replace(/\D/g, "");
      const clubDigits = clubPromptpayId.replace(/\D/g, "");
      if (detectedDigits.length >= 4 && clubDigits.length >= 4) {
        receiverOk =
          detectedDigits.slice(-4) === clubDigits.slice(-4);
      }
    }

    // 3b. Case-insensitive substring match on receiver name.
    if (!receiverOk && hasReceiverName && clubPromptpayName) {
      const detectedLower = detected.receiverName!.toLowerCase();
      const clubLower = clubPromptpayName.toLowerCase();
      receiverOk =
        detectedLower.includes(clubLower) || clubLower.includes(detectedLower);
    }

    if (!receiverOk) {
      return { result: "manual", reason: "receiver_mismatch" };
    }
  }
  // If neither receiverId nor receiverName is present, skip the check entirely.

  return { result: "verified", reason: "auto" };
}
