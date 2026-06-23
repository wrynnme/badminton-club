import { loadEnvLocal } from "./helpers/env";
import { adminClient, teardownE2E } from "./helpers/db";

// Runs once after the suite: delete every throwaway row → leaves prod net-zero.
export default async function globalTeardown(): Promise<void> {
  loadEnvLocal();
  await teardownE2E(adminClient());
}
