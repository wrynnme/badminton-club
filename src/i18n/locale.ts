import { cookies } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

// Plain server helper (NOT a server action) — safe to call from
// getRequestConfig in request.ts. Reads the locale cookie; falls back to the
// default (th) when absent/invalid, mirroring how the theme cookie is read.
export async function getUserLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : defaultLocale;
}
