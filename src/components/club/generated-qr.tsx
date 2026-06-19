"use client";

import dynamic from "next/dynamic";

const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });

/**
 * PromptPay QR. When `logoUrl` is set, overlays that logo in the centre (error-
 * correction level "H" / 30% keeps the ~26%-width logo scannable). `logoUrl` comes
 * from the site-wide setting (/admin) → null means the site owner turned it off.
 */
export function GeneratedQr({ value, size, logoUrl }: { value: string; size: number; logoUrl: string | null }) {
  const logo = Math.round(size * 0.26);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <QRCode value={value} size={size} level="H" />
      {logoUrl && (
        // white backing punches a clean hole in the QR behind the (transparent) logo
        <span
          className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md bg-white"
          style={{ width: logo, height: logo, padding: Math.round(logo * 0.1) }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="" className="h-full w-full object-contain" />
        </span>
      )}
    </div>
  );
}
