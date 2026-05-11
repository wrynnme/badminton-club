import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";

function safeRedirectTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/clubs";
  return value;
}

export async function GET(req: NextRequest) {
  const channelId = process.env.LINE_CHANNEL_ID;
  const redirectUri = process.env.LINE_REDIRECT_URI;
  if (!channelId || !redirectUri) {
    return NextResponse.json(
      { error: "LINE_CHANNEL_ID or LINE_REDIRECT_URI not set" },
      { status: 500 }
    );
  }

  const redirectTo = safeRedirectTo(new URL(req.url).searchParams.get("redirectTo"));
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");

  const store = await cookies();
  store.set("line_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  store.set("line_redirect_to", redirectTo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: "profile openid",
    nonce,
  });

  return NextResponse.redirect(
    `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`
  );
}
