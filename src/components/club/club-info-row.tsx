import type { ReactNode } from "react";

/** A labelled info row (icon/emoji + text) used in the club page header cards. */
export function ClubInfoRow({ label, text }: { label: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{text}</span>
    </div>
  );
}
