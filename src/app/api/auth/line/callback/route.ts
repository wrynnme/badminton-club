import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { setSession } from "@/lib/auth/session";
import { upsertLineProfile } from "@/lib/auth/line-profile";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const savedState = store.get("line_oauth_state")?.value;
  const redirectTo = store.get("line_redirect_to")?.value ?? "/clubs";
  store.delete("line_oauth_state");
  store.delete("line_redirect_to");

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(new URL("/?auth_error=state", req.url));
  }

  const channelId = process.env.LINE_CHANNEL_ID!;
  const channelSecret = process.env.LINE_CHANNEL_SECRET!;
  const redirectUri = process.env.LINE_REDIRECT_URI!;

  // Exchange code for token
  const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/?auth_error=token", req.url));
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string };

  // Fetch profile
  const profileRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!profileRes.ok) {
    return NextResponse.redirect(new URL("/?auth_error=profile", req.url));
  }
  const lineProfile = (await profileRes.json()) as {
    userId: string;
    displayName: string;
    pictureUrl?: string;
  };

  // Profile sync — shared with the LIFF auto-login endpoint (see line-profile.ts).
  // First login seeds display_name from LINE; return logins only refresh the
  // picture, so a name the user edited in /settings survives.
  const profile = await upsertLineProfile({
    userId: lineProfile.userId,
    displayName: lineProfile.displayName,
    pictureUrl: lineProfile.pictureUrl,
  });

  if (!profile) {
    return NextResponse.redirect(new URL("/?auth_error=db", req.url));
  }

  await setSession({
    profileId: profile.id,
    displayName: profile.display_name,
    pictureUrl: profile.picture_url,
    isGuest: false,
  });

  return NextResponse.redirect(new URL(redirectTo, req.url));
}
