import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";
import { matchSlipToBill, verifySlip } from "../slip-verify";
import { verifyLineSignature } from "../../notification/line-club";

// ---------------------------------------------------------------------------
// matchSlipToBill
// ---------------------------------------------------------------------------

describe("matchSlipToBill", () => {
  const BASE_BILL = 330;
  const CLUB_ID = "0812345678";   // 10-digit mobile → last 4 = "5678"
  const CLUB_NAME = "BadmintonClub";

  it("exact amount + matching receiver last-4 digits → verified", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: 330,
        receiverId: "xxxx5678", // last 4 match CLUB_ID
      },
      billAmount: BASE_BILL,
      clubPromptpayId: CLUB_ID,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "verified", reason: "auto" });
  });

  it("exact amount + matching receiver name (case-insensitive substring) → verified", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: 330,
        receiverName: "badmintonclub", // lower-case of CLUB_NAME
      },
      billAmount: BASE_BILL,
      clubPromptpayId: null,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "verified", reason: "auto" });
  });

  it("club name is substring of detected receiver name → verified", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: 330,
        receiverName: "BADMINTONCLUB SPORTS CENTER",
      },
      billAmount: BASE_BILL,
      clubPromptpayId: null,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "verified", reason: "auto" });
  });

  it("amount off by 1 → manual (amount_mismatch)", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: 329, // 1 THB short
        receiverId: "xxxx5678",
      },
      billAmount: BASE_BILL,
      clubPromptpayId: CLUB_ID,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "manual", reason: "amount_mismatch" });
  });

  it("amount difference exactly 0.01 → still verified (boundary)", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: 330.01, // exactly on the tolerance edge
        receiverId: "xxxx5678",
      },
      billAmount: BASE_BILL,
      clubPromptpayId: CLUB_ID,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "verified", reason: "auto" });
  });

  it("amount difference just over 0.01 → manual (amount_mismatch)", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: 330.02,
        receiverId: "xxxx5678",
      },
      billAmount: BASE_BILL,
      clubPromptpayId: CLUB_ID,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "manual", reason: "amount_mismatch" });
  });

  it("detected.ok=false → manual (verify_unavailable)", () => {
    const result = matchSlipToBill({
      detected: { ok: false, reason: "not_configured" },
      billAmount: BASE_BILL,
      clubPromptpayId: CLUB_ID,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "manual", reason: "verify_unavailable" });
  });

  it("detected.ok=false with provider_error → manual (verify_unavailable)", () => {
    const result = matchSlipToBill({
      detected: { ok: false, reason: "provider_error" },
      billAmount: BASE_BILL,
      clubPromptpayId: CLUB_ID,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "manual", reason: "verify_unavailable" });
  });

  it("receiver present but last-4 mismatched and no name → manual (receiver_mismatch)", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: 330,
        receiverId: "xxxx9999", // last 4 do NOT match "5678"
      },
      billAmount: BASE_BILL,
      clubPromptpayId: CLUB_ID,
      clubPromptpayName: null,
    });
    expect(result).toEqual({ result: "manual", reason: "receiver_mismatch" });
  });

  it("receiver name present but mismatched → manual (receiver_mismatch)", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: 330,
        receiverName: "CompletelyDifferentName",
      },
      billAmount: BASE_BILL,
      clubPromptpayId: null,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "manual", reason: "receiver_mismatch" });
  });

  it("receiver data absent (only amount matches) → verified (skip receiver check)", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: 330,
        // no receiverId, no receiverName
      },
      billAmount: BASE_BILL,
      clubPromptpayId: CLUB_ID,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "verified", reason: "auto" });
  });

  it("amount null → manual (amount_mismatch)", () => {
    const result = matchSlipToBill({
      detected: {
        ok: true,
        amount: undefined,
        receiverId: "xxxx5678",
      },
      billAmount: BASE_BILL,
      clubPromptpayId: CLUB_ID,
      clubPromptpayName: CLUB_NAME,
    });
    expect(result).toEqual({ result: "manual", reason: "amount_mismatch" });
  });
});

// ---------------------------------------------------------------------------
// verifyLineSignature
// ---------------------------------------------------------------------------

describe("verifyLineSignature", () => {
  const ORIGINAL_SECRET = process.env.LINE_MESSAGING_CHANNEL_SECRET;
  const TEST_SECRET = "test-channel-secret-abc123";
  const RAW_BODY = '{"events":[]}';

  function makeSignature(body: string, secret: string): string {
    return createHmac("sha256", secret).update(body).digest("base64");
  }

  beforeEach(() => {
    process.env.LINE_MESSAGING_CHANNEL_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.LINE_MESSAGING_CHANNEL_SECRET;
    } else {
      process.env.LINE_MESSAGING_CHANNEL_SECRET = ORIGINAL_SECRET;
    }
  });

  it("returns true when HMAC matches", () => {
    const sig = makeSignature(RAW_BODY, TEST_SECRET);
    expect(verifyLineSignature(RAW_BODY, sig)).toBe(true);
  });

  it("returns false when signature is wrong", () => {
    const wrongSig = makeSignature(RAW_BODY, "wrong-secret");
    expect(verifyLineSignature(RAW_BODY, wrongSig)).toBe(false);
  });

  it("returns false when signature is null", () => {
    expect(verifyLineSignature(RAW_BODY, null)).toBe(false);
  });

  it("returns false when LINE_MESSAGING_CHANNEL_SECRET is not set", () => {
    delete process.env.LINE_MESSAGING_CHANNEL_SECRET;
    const sig = makeSignature(RAW_BODY, TEST_SECRET);
    expect(verifyLineSignature(RAW_BODY, sig)).toBe(false);
  });

  it("returns false for a tampered body", () => {
    const sig = makeSignature(RAW_BODY, TEST_SECRET);
    expect(verifyLineSignature('{"events":[{"tampered":true}]}', sig)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifySlip — config-driven (no env reads)
// ---------------------------------------------------------------------------

describe("verifySlip — config-driven", () => {
  it("provider=null, apiKey=null → not_configured", async () => {
    const result = await verifySlip(
      { imageBuffer: Buffer.from("fake") },
      { provider: null, apiKey: null },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_configured");
  });

  it("provider set but apiKey=null → not_configured", async () => {
    const result = await verifySlip(
      { imageBuffer: Buffer.from("fake") },
      { provider: "easyslip", apiKey: null },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_configured");
  });

  it("apiKey set but provider=null → not_configured", async () => {
    const result = await verifySlip(
      { imageBuffer: Buffer.from("fake") },
      { provider: null, apiKey: "some-key" },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_configured");
  });

  it("no imageBuffer (payload-only path) → invalid", async () => {
    const result = await verifySlip(
      { payload: "some-payload" },
      { provider: "easyslip", apiKey: "some-key" },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid");
  });

  it("slipok with branchId=null → not_configured (no network call)", async () => {
    // fetch should never be called when branchId is absent
    const fetchSpy = vi.spyOn(global, "fetch");
    const result = await verifySlip(
      { imageBuffer: Buffer.from("fake") },
      { provider: "slipok", apiKey: "some-key", branchId: null },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("easyslip provider error (fetch throws) → provider_error", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("network down"));
    const result = await verifySlip(
      { imageBuffer: Buffer.from("fake") },
      { provider: "easyslip", apiKey: "some-key" },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("provider_error");
    fetchSpy.mockRestore();
  });

  it("slipok provider error (fetch throws) → provider_error", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("network down"));
    const result = await verifySlip(
      { imageBuffer: Buffer.from("fake") },
      { provider: "slipok", apiKey: "some-key", branchId: "99" },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("provider_error");
    fetchSpy.mockRestore();
  });

  it("slipok: fetch URL includes branchId", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    await verifySlip(
      { imageBuffer: Buffer.from("fake") },
      { provider: "slipok", apiKey: "some-key", branchId: "branch-42" },
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("branch-42");
    fetchSpy.mockRestore();
  });
});
