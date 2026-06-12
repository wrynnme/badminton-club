import { th, enUS } from "date-fns/locale";

/**
 * Map an app locale string to the matching date-fns Locale object.
 * Accepts a plain string so it can be called from both server (AppLocale)
 * and client (useLocale() returns string) contexts without an extra cast.
 * Anything that isn't "en" falls back to Thai.
 */
export function dateFnsLocaleOf(locale: string) {
  return locale === "en" ? enUS : th;
}
