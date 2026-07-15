import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function truncate(s: string, n = 14): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Date → "YYYY-MM-DD" (the shape `<input type="date">` and Postgres `date` expect). */
export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}
