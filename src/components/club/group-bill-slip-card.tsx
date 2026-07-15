"use client";

import { SlipQr } from "@/components/club/club-slip-card";
import type { SlipPaymentResolution } from "@/lib/club/slip-payment";
import type { Club } from "@/lib/types";

// Labels are HARDCODED Thai, not useTranslations: this card is a LINE-bound
// artifact (pushed into the club's LINE group next to the server-built Thai
// roster messages), and LINE bodies are intentionally Thai-only by project
// convention (AGENTS.md — same carve-out as notification bodies, mirrors
// GROUP_BILL_SCAN_PROMPT in group-billing.ts). The dialog preview deliberately
// shows the exact Thai artifact that gets posted.
const TH = {
  groupTitle: "บิลรวม",
  groupHint: "สแกน QR แล้วกรอกยอดของตัวเอง",
  bankTransfer: "โอนเข้าบัญชี",
  footerNote: (name: string) => `พร้อมเพย์ · ${name}`,
} as const;

/**
 * GroupBillSlipCard — the slip-styled PNG attached to the LINE **group** bill push
 * (`group-bill-dialog.tsx`). Unlike the per-player `SlipCard` (whose QR has the
 * amount embedded — DO NOT reuse that behavior here), this card carries no
 * player/amount: everyone in the group scans the SAME amount-less QR and enters
 * their own total from the numbered roster text message that precedes it.
 *
 * Same visual family as `SlipCard` (360px width, theme header band, club logo /
 * 🏸 fallback, `SlipQr` raster-<img> QR — required by modern-screenshot, see the
 * caveat on that export) so the two receipts look consistent, but the layout is
 * simpler: no player name / itemized rows / total, just branding + QR + receiver
 * info + a "scan and enter your own amount" hint.
 *
 * The dialog only ever mounts this when `payment.qrValue || payment.ppImage`, so
 * the card assumes at least one QR channel resolved.
 */
type GroupBillSlipCardProps = {
  club: Club;
  /** Pre-resolved payment channels — `resolveSlipPayment` WITHOUT `amount` (the
   *  amount-less group form), computed once by the dialog and shared with its
   *  attach gate so the two can never disagree. */
  payment: SlipPaymentResolution;
  /** th-pinned display date, computed once by the dialog (matches the sent
   *  roster header, which the server builds with dateFnsLocaleOf("th")). */
  dateStr: string;
};

export function GroupBillSlipCard({ club, payment, dateStr }: GroupBillSlipCardProps) {
  const { qrValue, ppImage, showPromptpay, showBank, tpl, theme } = payment;
  const footerNote = tpl.footer_note;

  return (
    <div
      style={{
        width: 360,
        flexShrink: 0,
        marginInline: "auto",
        fontFamily: "Anuphan, sans-serif",
        backgroundColor: "#ffffff",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
      }}
    >
      {/* Header band — club branding + "group bill" title + date, same theme
          color convention as SlipCard's header. */}
      <div
        style={{
          backgroundColor: theme.headerBg,
          padding: "16px 20px 14px",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "Chakra Petch, Anuphan, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 0.2,
          }}
        >
          {club.receipt_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={club.receipt_logo_url}
              alt=""
              width={26}
              height={26}
              style={{
                width: 26,
                height: 26,
                objectFit: "contain",
                borderRadius: 6,
                background: "#ffffff",
                flexShrink: 0,
              }}
            />
          ) : (
            <span>🏸</span>
          )}
          <span>{club.name}</span>
        </div>
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.85 }}>
          {TH.groupTitle}
          {dateStr ? ` · ${dateStr}` : ""}
        </div>
      </div>

      {/* QR block — same box styling as SlipCard's, but amount-less: a "scan then
          enter your own amount" hint replaces the per-amount transfer hint. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "20px 20px 16px",
          backgroundColor: "#ffffff",
        }}
      >
        <div
          style={{
            backgroundColor: "#f9fafb",
            borderRadius: 12,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          {qrValue ? (
            <SlipQr value={qrValue} size={220} logoUrl={null} />
          ) : ppImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ppImage}
              alt=""
              width={220}
              height={220}
              style={{ objectFit: "contain" }}
            />
          ) : null}

          {(qrValue || ppImage) && (
            <span style={{ fontSize: 11, color: "#6b7280", textAlign: "center" }}>
              {TH.groupHint}
            </span>
          )}

          {/* Bank-account receiver (#12a) — plain text, same block as SlipCard */}
          {showBank && (
            <div
              style={{
                textAlign: "center",
                fontSize: 13,
                color: "#374151",
                lineHeight: 1.5,
                padding: qrValue || ppImage ? "8px 4px 0" : "4px",
              }}
            >
              <div style={{ fontWeight: 700, color: "#111827" }}>{TH.bankTransfer}</div>
              <div style={{ fontVariantNumeric: "tabular-nums" }}>
                {tpl.bank.name} · {tpl.bank.account_no}
              </div>
              <div style={{ color: "#6b7280", fontSize: 12 }}>{tpl.bank.account_name}</div>
            </div>
          )}
        </div>
      </div>

      {/* Footer — same promptpay-name / footer_note block as SlipCard */}
      {((showPromptpay && (club.promptpay_name || club.promptpay_id)) || footerNote) && (
        <div
          style={{
            padding: "0 20px 16px",
            fontSize: 11,
            color: "#9ca3af",
            textAlign: "center",
            backgroundColor: "#ffffff",
          }}
        >
          {showPromptpay && (club.promptpay_name || club.promptpay_id) && (
            <div>{TH.footerNote(club.promptpay_name || club.promptpay_id || "")}</div>
          )}
          {footerNote && (
            <div style={{ marginTop: 3, color: "#6b7280", whiteSpace: "pre-wrap" }}>
              {footerNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
