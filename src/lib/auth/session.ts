import { cache } from "react";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";

const COOKIE_NAME = "bc_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type SessionPayload = {
  profileId: string;
  displayName: string;
  pictureUrl?: string | null;
  isGuest: boolean;
};

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET not set");
  return s;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

// Internal wire shape: the public payload plus an issued-at timestamp (epoch
// seconds, for expiry) and a `sv` session_version (for per-profile revocation).
// Both are stamped by setSession(), so callers never pass them.
type StoredPayload = SessionPayload & { iat: number; sv: number };

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function encode(payload: SessionPayload, sv: number) {
  const stored: StoredPayload = { ...payload, iat: nowSec(), sv };
  const json = Buffer.from(JSON.stringify(stored)).toString("base64url");
  return `${json}.${sign(json)}`;
}

function decode(token: string): (SessionPayload & { sv: number }) | null {
  const [json, sig] = token.split(".");
  if (!json || !sig) return null;
  const expected = sign(json);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: Partial<StoredPayload>;
  try {
    parsed = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as Partial<StoredPayload>;
  } catch {
    return null;
  }
  // Server-enforced expiry: the cookie's maxAge is browser-only and does NOT stop a
  // replayed/leaked token. Reject tokens with no `iat` (incl. all pre-expiry-rollout
  // cookies → one forced re-login) or issued more than MAX_AGE ago.
  if (typeof parsed.iat !== "number" || nowSec() - parsed.iat > MAX_AGE) return null;
  // Validate shape instead of blindly trusting the signed JSON's structure.
  if (
    typeof parsed.profileId !== "string" ||
    typeof parsed.displayName !== "string" ||
    typeof parsed.isGuest !== "boolean"
  ) {
    return null;
  }
  return {
    profileId: parsed.profileId,
    displayName: parsed.displayName,
    pictureUrl: parsed.pictureUrl ?? null,
    isGuest: parsed.isGuest,
    // Graceful revocation: a token minted before the session_version rollout has
    // no `sv` → treat as 0 (the column default) so it is NOT force-invalidated.
    sv: typeof parsed.sv === "number" ? parsed.sv : 0,
  };
}

export async function setSession(payload: SessionPayload) {
  // Stamp the profile's current session_version into the token. A later
  // revokeSessionsAction bumps that column, which invalidates this token.
  const sb = await createAdminClient();
  const { data } = await sb
    .from("profiles")
    .select("session_version")
    .eq("id", payload.profileId)
    .maybeSingle();
  const sv = (data?.session_version as number | null) ?? 0;
  const store = await cookies();
  store.set(COOKIE_NAME, encode(payload, sv), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

// React cache(): per-request dedupe. getSession() has ~97 call sites and a single
// page render hits it several times (site-header + page + helpers) — without
// cache() each call would repeat the session_version SELECT. With it, the
// revocation check costs exactly ONE profiles PK lookup per request; a bump
// takes effect on the next request, which is all "logout everywhere" needs.
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const tok = store.get(COOKIE_NAME)?.value;
  if (!tok) return null;
  const decoded = decode(tok);
  if (!decoded) return null;
  // Per-profile revocation: compare the token's stamped session_version with the
  // live one ("log out everywhere" / a future compromise response bumps it).
  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("profiles")
    .select("session_version")
    .eq("id", decoded.profileId)
    .maybeSingle();
  if (error) {
    // Fail open on a transient DB blip: the HMAC + iat checks already passed, so
    // skip the best-effort revocation check rather than log every user out.
    console.error("session_version check failed", error);
  } else if (!data) {
    return null; // profile no longer exists → session invalid
  } else if (decoded.sv !== ((data.session_version as number | null) ?? 0)) {
    // Revoked: bump_session_version ran after this token was minted. (A new login
    // does NOT bump — multi-device sessions stay valid side by side by design.)
    return null;
  }
  return {
    profileId: decoded.profileId,
    displayName: decoded.displayName,
    pictureUrl: decoded.pictureUrl,
    isGuest: decoded.isGuest,
  };
});

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
