"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("theme", theme);
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `theme=${theme}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function ThemeToggle({
  className,
  iconClassName = "h-4 w-4",
}: {
  className?: string;
  iconClassName?: string;
} = {}) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next: Theme = isDark ? "light" : "dark";
    applyTheme(next);
    setIsDark(!isDark);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      className={className}
    >
      <Sun
        className={cn(
          "rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0",
          iconClassName,
        )}
      />
      <Moon
        className={cn(
          "absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100",
          iconClassName,
        )}
      />
    </Button>
  );
}
