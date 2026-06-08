import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

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
// seconds) that the server uses to enforce expiry. `iat` is stamped here, so
// callers of setSession() never pass it.
type StoredPayload = SessionPayload & { iat: number };

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function encode(payload: SessionPayload) {
  const stored: StoredPayload = { ...payload, iat: nowSec() };
  const json = Buffer.from(JSON.stringify(stored)).toString("base64url");
  return `${json}.${sign(json)}`;
}

function decode(token: string): SessionPayload | null {
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
  };
}

export async function setSession(payload: SessionPayload) {
  const store = await cookies();
  store.set(COOKIE_NAME, encode(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const tok = store.get(COOKIE_NAME)?.value;
  if (!tok) return null;
  return decode(tok);
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
