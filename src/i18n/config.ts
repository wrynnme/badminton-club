// i18n configuration — cookie-based locale (no URL routing), mirrors the
// existing `theme` cookie pattern read server-side in the root layout.

export const locales = ["th", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "th";

export const LOCALE_COOKIE = "locale";

// Message namespaces. Each maps to messages/<locale>/<ns>.json. Adding a
// namespace = create both locale files + add the key here; request.ts loops
// over this list, so namespaces can be filled in parallel without touching
// a single shared catalog file.
export const NAMESPACES = [
  "common", // shared buttons / labels (บันทึก, ยกเลิก, ลบ …)
  "nav", // site header + mobile nav
  "home", // landing page
  "auth", // login / guest
  "settings", // /settings profile
  "club", // club components
  "tournament", // tournament components
  "stats", // stats views
  "validation", // zod / form error messages
  "actions", // server-action error / toast strings
  "admin", // site-owner /admin page (global settings)
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export function isLocale(value: string | undefined): value is Locale {
  return value === "th" || value === "en";
}
