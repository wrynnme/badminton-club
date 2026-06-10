import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { setSession } from "@/lib/auth/session";

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

  // Profile sync. First login seeds display_name from LINE; return logins only
  // refresh the picture and DO NOT touch display_name, so a name the user edited
  // in /settings survives. Trade-off: LINE-side renames are no longer mirrored.
  // (A plain upsert can't do this — onConflict would overwrite every column,
  // display_name included.)
  const sb = await createAdminClient();

  const { data: updated, error: updateError } = await sb
    .from("profiles")
    .update({ picture_url: lineProfile.pictureUrl ?? null, is_guest: false })
    .eq("line_user_id", lineProfile.userId)
    .select()
    .maybeSingle();

  if (updateError) {
    return NextResponse.redirect(new URL("/?auth_error=db", req.url));
  }

  let profile = updated;
  if (!profile) {
    // First login for this LINE account.
    const { data: inserted, error: insertError } = await sb
      .from("profiles")
      .insert({
        line_user_id: lineProfile.userId,
        display_name: lineProfile.displayName,
        picture_url: lineProfile.pictureUrl ?? null,
        is_guest: false,
      })
      .select()
      .single();

    if (insertError?.code === "23505") {
      // Concurrent first-login race: a parallel request inserted the row between
      // our update and insert. Re-read it instead of failing the login.
      const { data: raced } = await sb
        .from("profiles")
        .select()
        .eq("line_user_id", lineProfile.userId)
        .single();
      profile = raced ?? null;
    } else if (!insertError) {
      profile = inserted;
    }
  }

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
