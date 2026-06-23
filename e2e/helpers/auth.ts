import { createHmac } from "node:crypto";

// Mint a bc_session cookie exactly as src/lib/auth/session.ts encode() does:
// base64url(JSON({...payload, iat, sv})) + "." + base64url(HMAC-SHA256(json, SESSION_SECRET)).
// Reads SESSION_SECRET from the environment (loaded from .env.local by loadEnvLocal()).
export function mintSessionCookie(opts: {
  profileId: string;
  displayName: string;
  sv?: number;
}): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set (check .env.local)");
  const payload = {
    profileId: opts.profileId,
    displayName: opts.displayName,
    isGuest: false,
    iat: Math.floor(Date.now() / 1000),
    sv: opts.sv ?? 0,
  };
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(json).digest("base64url");
  return `${json}.${sig}`;
}
