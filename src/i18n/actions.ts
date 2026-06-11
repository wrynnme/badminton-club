"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./config";

// Persist the chosen locale in a cookie (1 year). The client switcher calls
// this then triggers router.refresh() so the server re-renders with the new
// locale — same shape as the theme toggle.
export async function setLocaleAction(locale: Locale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    path: "/",
  });
}
