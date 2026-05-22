import Link from "next/link";
import { Trophy } from "lucide-react";
import { TvFullscreenButton } from "@/components/tournament/tv-fullscreen-button";
import { TOURNAMENT_STATUS_LABEL } from "@/lib/tournament/status";
import type { TournamentStatus } from "@/lib/types";

export type PublicTvHeaderExtraLink = {
  href: string;
  label: string;
};

export type PublicTvHeaderProps = {
  name: string;
  venue?: string | null;
  status: TournamentStatus;
  /** Show the Trophy icon to the left of the title. Default: false. */
  showTrophyIcon?: boolean;
  /** Always render the fullscreen button, or hide it entirely. Default: true. */
  showFullscreenButton?: boolean;
  /** Back-navigation link rendered last in the actions row. */
  backLink: PublicTvHeaderExtraLink;
  /** Optional extra action links rendered between fullscreen button and back link. */
  extraLinks?: PublicTvHeaderExtraLink[];
};

/**
 * Compact fixed-height header shared by the TV display and bracket pages.
 * Both callers are async server components — this component is intentionally
 * a server component (no "use client" directive).
 */
export function PublicTvHeader({
  name,
  venue,
  status,
  showTrophyIcon = false,
  showFullscreenButton = true,
  backLink,
  extraLinks = [],
}: PublicTvHeaderProps) {
  return (
    <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <div className="flex items-center gap-3 lg:gap-4 min-w-0">
        {showTrophyIcon && (
          <Trophy className="h-8 w-8 lg:h-10 lg:w-10 2xl:h-12 2xl:w-12 shrink-0" />
        )}
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-4xl xl:text-5xl 2xl:text-6xl font-bold truncate leading-tight">
            {name}
          </h1>
          {venue && (
            <p className="text-sm lg:text-xl 2xl:text-2xl text-muted-foreground truncate leading-tight">
              {venue}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 lg:gap-4">
        <span className="px-3 py-1 lg:px-4 lg:py-1.5 rounded-full border text-sm lg:text-lg 2xl:text-xl font-semibold">
          {TOURNAMENT_STATUS_LABEL[status] ?? status}
        </span>
        {showFullscreenButton && <TvFullscreenButton />}
        {extraLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm lg:text-base 2xl:text-lg text-muted-foreground hover:text-foreground underline"
          >
            {link.label}
          </Link>
        ))}
        <Link
          href={backLink.href}
          className="text-sm lg:text-base 2xl:text-lg text-muted-foreground hover:text-foreground underline"
        >
          {backLink.label}
        </Link>
      </div>
    </header>
  );
}
