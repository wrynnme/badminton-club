import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./helpers/env";
import { adminClient, seedE2E } from "./helpers/db";
import { mintSessionCookie } from "./helpers/auth";
import { E2E } from "./helpers/fixtures";

// Runs once before the suite: load env → seed throwaway club → mint the owner's
// bc_session cookie → write a Playwright storageState so every test is logged in.
export default async function globalSetup(): Promise<void> {
  loadEnvLocal();
  await seedE2E(adminClient());

  const token = mintSessionCookie({ profileId: E2E.ownerId, displayName: E2E.ownerName, sv: 0 });
  const storageState = {
    cookies: [
      {
        name: "bc_session",
        value: token,
        domain: "localhost",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [] as never[],
  };

  const dir = resolve(process.cwd(), "e2e/.auth");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "state.json"), JSON.stringify(storageState, null, 2));
}
