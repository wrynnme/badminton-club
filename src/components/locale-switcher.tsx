"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { setLocaleAction } from "@/i18n/actions";
import type { Locale } from "@/i18n/config";

// Two-way TH⇄EN toggle. Persists the locale cookie via a server action, then
// router.refresh() so the server re-renders with the new message catalog
// (next-intl reads the cookie server-side). Mirrors ThemeToggle's placement.
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const next: Locale = locale === "th" ? "en" : "th";
  const label = next === "en" ? "EN" : "ไทย";

  const switchLocale = () => {
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            onClick={switchLocale}
            disabled={pending}
            aria-label="สลับภาษา / Switch language"
          >
            <Languages className="h-4 w-4" />
            <span className="text-xs font-medium">{label}</span>
          </Button>
        }
      />
      <TooltipContent>สลับภาษา / Switch language</TooltipContent>
    </Tooltip>
  );
}
