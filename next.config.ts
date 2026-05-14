import { execSync } from "child_process";
import { readFileSync } from "fs";
import type { NextConfig } from "next";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

const gitHash = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
})();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_GIT_COMMIT: gitHash,
  },
};

export default nextConfig;
