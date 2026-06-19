import { NextRequest, NextResponse } from "next/server";
import { setSession } from "@/lib/auth/session";
import { upsertLineProfile } from "@/lib/auth/line-profile";

// LIFF auto-login: the client (inside the LINE in-app browser) posts the LIFF
// ID token here. We verify it with LINE, upsert the profile, and mint a
// bc_session — the same session a manual OAuth login produces. A guest session
// is silently upgraded to the real LINE account (setSession overwrites it).
//
// Setup: the LIFF app MUST live under the same LINE Login channel as
// LINE_CHANNEL_ID, so the ID token's `aud` equals our channel id and LINE's
// verify endpoint accepts it. Scopes required: openid + profile.

type IdTokenClaims = {
  sub?: string; // LINE userId
  name?: string;
  picture?: string;
};

export async function POST(req: NextRequest) {
  const channelId = process.env.LINE_CHANNEL_ID;
  if (!channelId) {
    return NextResponse.json({ error: "line_not_configured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const idToken = (body as { idToken?: unknown }).idToken;
  if (typeof idToken !== "string" || idToken.length === 0) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Verify the ID token server-side. LINE validates the JWT signature, expiry,
  // and that `aud` === client_id — so a token forged or minted for any other
  // channel is rejected here. This is what makes trusting the token safe.
  const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });

  if (!verifyRes.ok) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  const claims = (await verifyRes.json()) as IdTokenClaims;
  if (!claims.sub) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const profile = await upsertLineProfile({
    userId: claims.sub,
    // `name`/`picture` need the `profile` scope. Fall back so the NOT-NULL
    // display_name insert never fails; existing names are preserved anyway.
    displayName: claims.name ?? "LINE",
    pictureUrl: claims.picture ?? null,
  });
  if (!profile) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  await setSession({
    profileId: profile.id,
    displayName: profile.display_name,
    pictureUrl: profile.picture_url,
    isGuest: false,
  });

  return NextResponse.json({ ok: true });
}
