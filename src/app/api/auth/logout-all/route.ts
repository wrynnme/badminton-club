import { NextResponse } from "next/server";
import { getSession, clearSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

// "Log out everywhere": bump the profile's session_version so every previously
// issued token (including this one) fails getSession()'s version check, then
// clear this device's cookie. Use this when a token may have leaked.
export async function POST(req: Request) {
  const session = await getSession();
  if (session) {
    const sb = await createAdminClient();
    await sb.rpc("bump_session_version", { p_profile_id: session.profileId });
  }
  await clearSession();
  return NextResponse.redirect(new URL("/", req.url), 303);
}
