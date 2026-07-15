import { buildPromptPayPayload } from "@/lib/club/promptpay";
import {
  parseReceiptTemplate,
  hasBankReceiver,
  resolveReceiptTheme,
  type ReceiptTemplate,
  type ReceiptTheme,
} from "@/lib/club/receipt";
import type { Club } from "@/lib/types";

/**
 * Pure payment-channel resolution shared by BOTH slip artifacts:
 *
 * - per-player `SlipCard` (club-slip-card.tsx) — passes `amount` so the QR embeds
 *   the player's total (dynamic QR);
 * - group `GroupBillSlipCard` (group-bill-slip-card.tsx) + the group-bill dialog's
 *   attach gate — omits `amount`, so the QR is static/amount-less and everyone in
 *   the LINE group scans the same code and types their own total.
 *
 * One resolver = the channel-priority rules (promptpay display toggle → number
 * wins → uploaded image fallback → bank block additive) cannot drift between the
 * two billing surfaces. Kept in lib/club (pure, node-testable — this repo's vitest
 * has no DOM harness).
 */
export type SlipPaymentResolution = {
  /** Parsed receipt customization — callers also read `tpl.fields` / `tpl.bank` /
   *  `tpl.footer_note` off this instead of re-parsing the jsonb. */
  tpl: ReceiptTemplate;
  theme: ReceiptTheme;
  /** Whether the owner's receipt template has PromptPay display enabled at all
   *  (independent of whether a number/image actually resolved). */
  showPromptpay: boolean;
  /** PromptPay payload string — amount-embedded when `amount` was passed (> 0),
   *  static/amount-less otherwise; "" when no valid number / display toggled off. */
  qrValue: string;
  /** Uploaded QR image URL to render instead of `qrValue`, or null. Only set when
   *  `qrValue` is empty (number takes priority). */
  ppImage: string | null;
  /** Whether the bank-account receiver (#12a) block should render. */
  showBank: boolean;
  /** True when at least one payment channel (QR value, QR image, or bank) renders. */
  anyPayment: boolean;
};

export function resolveSlipPayment(
  club: Pick<Club, "promptpay_id" | "receipt_template">,
  /** true when `club.promptpay_id` is a valid PromptPay proxy (caller checks via
   *  `isValidPromptPayId` — kept out of this module to avoid re-validating). */
  ppNumber: boolean,
  /** `club.promptpay_qr_image`, only meaningful when `ppNumber` is false. */
  qrImage: string | null,
  /** Player total to embed in the QR (per-player slip). Omit for the group slip —
   *  the whole point there is one reusable, amount-less QR. */
  amount?: number,
): SlipPaymentResolution {
  const tpl = parseReceiptTemplate(club.receipt_template);
  const theme = resolveReceiptTheme(tpl.theme);
  const showPromptpay = tpl.payment_show.promptpay;

  const qrValue =
    showPromptpay && ppNumber && club.promptpay_id
      ? amount === undefined
        ? buildPromptPayPayload(club.promptpay_id)
        : buildPromptPayPayload(club.promptpay_id, amount)
      : "";
  const ppImage = showPromptpay && !qrValue && qrImage ? qrImage : null;
  const showBank = tpl.payment_show.bank && hasBankReceiver(tpl.bank);
  const anyPayment = !!qrValue || !!ppImage || showBank;

  return { tpl, theme, showPromptpay, qrValue, ppImage, showBank, anyPayment };
}
