import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Playwright's node context does not auto-load .env.local (Next does). Load it so
// global-setup can read SESSION_SECRET + Supabase keys. Existing process.env wins
// (so CI / shell exports override the file).
export function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // optional — env may already be set by the shell/CI
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] != null) continue;
    process.env[key] = m[2].replace(/^["']|["']$/g, "");
  }
}
