/**
 * slip-verify.ts — provider-agnostic slip-verification adapter.
 *
 * `verifySlip(input, config)` is the outbound adapter seam. Provider selection is
 * driven by the per-club `SlipVerifyConfig` passed by the caller — no env vars are
 * read here. Swap providers by updating `clubs.billing_verify_settings` + the
 * corresponding `club_billing_secrets` row via `updateClubBillingVerifySettingsAction`.
 *
 * `matchSlipToBill` is a pure, side-effect-free decision function that maps a
 * SlipVerifyResult + bill parameters to a final verification outcome. It is
 * fully testable without network access.
 *
 * Deprecated env vars (no longer read by this module):
 *   SLIP_VERIFY_PROVIDER, SLIP_VERIFY_API_KEY, SLIP_VERIFY_SLIPOK_BRANCH_ID
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
  reason?: string;       // when !ok: "not_configured" | "provider_error" | "invalid" | "manual_mode"
};

/**
 * Per-call config derived from `clubs.billing_verify_settings` + `club_billing_secrets`.
 * The webhook resolves this before calling verifySlip — no env reads inside.
 */
export type SlipVerifyConfig = {
  provider: "easyslip" | "slipok" | null;
  apiKey: string | null;
  branchId?: string | null;
};

// ---------------------------------------------------------------------------
// verifySlip — adapter entry point
// ---------------------------------------------------------------------------

/**
 * Verify a payment slip against the club's configured provider.
 *
 * Input: either an `imageBuffer` (raw image bytes) or a `payload` string.
 * Config: caller resolves provider/apiKey/branchId from club_billing_secrets — never
 *         read from env.
 *
 * When provider or apiKey is absent, returns `{ ok: false, reason: "not_configured" }`
 * immediately so callers can fall through to `matchSlipToBill` which routes that to
 * `"manual"`.
 */
export async function verifySlip(
  input: { imageBuffer?: Buffer; payload?: string },
  config: SlipVerifyConfig,
): Promise<SlipVerifyResult> {
  const { provider, apiKey } = config;

  if (!provider || !apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  // Only image-based verification is wired today (the webhook always sends the
  // slip image bytes). A payload-only call has nothing to send.
  const image = input.imageBuffer;
  if (!image) return { ok: false, reason: "invalid" };

  try {
    switch (provider) {
      case "easyslip":
        return await callEasySlip(image, apiKey);
      case "slipok":
        return await callSlipOk(image, apiKey, config.branchId ?? null);
      default:
        console.error("[SLIP-VERIFY] Unknown provider:", provider);
        return { ok: false, reason: "not_configured" };
    }
  } catch (err) {
    console.error("[SLIP-VERIFY] provider call failed:", err);
    return { ok: false, reason: "provider_error" };
  }
}

// ---------------------------------------------------------------------------
// Provider adapters — normalise each provider's response to SlipVerifyResult.
// ---------------------------------------------------------------------------

type EasySlipData = {
  transRef?: string;
  amount?: { amount?: number };
  receiver?: {
    account?: {
      name?: { th?: string; en?: string };
      proxy?: { value?: string };
      bank?: { account?: string };
    };
  };
};

/**
 * EasySlip — POST https://developer.easyslip.com/api/v1/verify
 * Auth: `Authorization: Bearer <key>` · multipart/form-data field `file`.
 * Success: `{ status: 200, data: { transRef, amount: { amount }, receiver: { account: { name: { th, en }, proxy, bank } } } }`.
 */
async function callEasySlip(image: Buffer, apiKey: string): Promise<SlipVerifyResult> {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "slip.jpg");
  const res = await fetch("https://developer.easyslip.com/api/v1/verify", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  const json: unknown = await res.json().catch(() => null);
  const body = json as { status?: number; data?: EasySlipData } | null;
  if (!res.ok || !body || body.status !== 200 || !body.data) {
    return { ok: false, reason: "invalid", raw: json };
  }
  const acct = body.data.receiver?.account;
  return {
    ok: true,
    amount: typeof body.data.amount?.amount === "number" ? body.data.amount.amount : undefined,
    receiverName: acct?.name?.th ?? acct?.name?.en,
    receiverId: acct?.proxy?.value ?? acct?.bank?.account,
    transRef: body.data.transRef,
    raw: json,
  };
}

type SlipOkData = {
  amount?: number;
  transRef?: string;
  receiver?: {
    displayName?: string;
    name?: string;
    proxy?: { value?: string };
    account?: { value?: string };
  };
};

/**
 * SlipOK — POST https://api.slipok.com/api/line/apikey/<branchId>
 * Auth: header `x-authorization: <key>` · multipart/form-data field `files`.
 * branchId is passed explicitly (no env read); returns not_configured when absent.
 * Success: `{ success: true, data: { amount, transRef, receiver: { displayName, name, proxy, account } } }`.
 */
async function callSlipOk(
  image: Buffer,
  apiKey: string,
  branchId: string | null,
): Promise<SlipVerifyResult> {
  if (!branchId) {
    console.error("[SLIP-VERIFY] SlipOK requires branchId — not configured for this club");
    return { ok: false, reason: "not_configured" };
  }
  const fd = new FormData();
  fd.append("files", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "slip.jpg");
  const res = await fetch(`https://api.slipok.com/api/line/apikey/${branchId}`, {
    method: "POST",
    headers: { "x-authorization": apiKey },
    body: fd,
  });
  const json: unknown = await res.json().catch(() => null);
  const body = json as { success?: boolean; data?: SlipOkData } | null;
  if (!res.ok || !body?.success || !body.data) {
    return { ok: false, reason: "invalid", raw: json };
  }
  return {
    ok: true,
    amount: typeof body.data.amount === "number" ? body.data.amount : undefined,
    receiverName: body.data.receiver?.displayName ?? body.data.receiver?.name,
    receiverId: body.data.receiver?.proxy?.value ?? body.data.receiver?.account?.value,
    transRef: body.data.transRef,
    raw: json,
  };
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
    //     Length floor: both strings must be >= 3 chars (trimmed) before
    //     substring matching. A very short clubPromptpayName (e.g. "A")
    //     would match almost any receiver name — false-positive auto-verify.
    //     When either side is too short, receiverOk stays false → manual.
    if (!receiverOk && hasReceiverName && clubPromptpayName) {
      const detectedLower = detected.receiverName!.trim().toLowerCase();
      const clubLower = clubPromptpayName.trim().toLowerCase();
      if (clubLower.length >= 3 && detectedLower.length >= 3) {
        receiverOk =
          detectedLower.includes(clubLower) || clubLower.includes(detectedLower);
      }
    }

    if (!receiverOk) {
      return { result: "manual", reason: "receiver_mismatch" };
    }
  }
  // If neither receiverId nor receiverName is present, skip the check entirely.

  return { result: "verified", reason: "auto" };
}
