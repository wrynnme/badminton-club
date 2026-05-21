import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Truncate a string to `n` chars, appending an ellipsis when it would exceed.
 * Example: truncate("HelloWorld", 6) -> "Hello…"
 */
export function truncate(s: string, n = 14): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
