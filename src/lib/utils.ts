import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function truncate(s: string, n = 14): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Date → "YYYY-MM-DD" (the shape `<input type="date">` and Postgres `date` expect). */
// LOCAL calendar date (YYYY-MM-DD) — client-side only (both consumers are
// "use client" date pickers). Was toISOString() = UTC: between midnight and
// 07:00 Thai time that returned "yesterday", pre-filling wrong default dates
// in the create-club and open-round forms (found by flow Step 4 smoke).
export function toDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA")
}
