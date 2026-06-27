import type { StorybookConfig } from "@storybook/nextjs-vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@chromatic-com/storybook",
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-mcp",
  ],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],
  async viteFinal(viteConfig) {
    // Server-action modules are "use server" + pull supabase/service-role +
    // next/headers, which cannot load in the browser. Alias them to no-op stubs
    // so stories that import client components which reference these actions
    // (e.g. MatchRow → resetMatchScoreAction, ScoreForm → recordMatchScoreAction)
    // can render. Exact-match regex + prepend so it wins over the framework's
    // general "@/" alias.
    const mockPath = path.resolve(dirname, "./mocks/actions-matches.ts");
    viteConfig.resolve ??= {};
    const existing = viteConfig.resolve.alias;
    const existingArray = Array.isArray(existing)
      ? existing
      : Object.entries(existing ?? {}).map(([find, replacement]) => ({
          find,
          replacement: replacement as string,
        }));
    viteConfig.resolve.alias = [
      { find: /^@\/lib\/actions\/matches$/, replacement: mockPath },
      ...existingArray,
    ];
    return viteConfig;
  },
};

export default config;
