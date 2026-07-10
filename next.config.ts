import { readFileSync } from "fs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const { version } = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  experimental: {
    // QR images upload through a server action as a base64 data URL (~1.37× the raw
    // bytes). The club-qr bucket caps files at 1MB, so allow up to 2MB of body here —
    // otherwise a ~750KB+ image would hit Next's default 1MB server-action body limit.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default withNextIntl(nextConfig);
