import type { Preview } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import { TooltipProvider } from "../src/components/ui/tooltip";

import "../src/app/globals.css";

// Thai message catalogs — load every namespace so any component calling
// useTranslations("<ns>") renders with real strings instead of throwing.
// (Explicit imports keep this type-safe and avoid import.meta.glob typing.)
import common from "../messages/th/common.json";
import nav from "../messages/th/nav.json";
import home from "../messages/th/home.json";
import auth from "../messages/th/auth.json";
import settings from "../messages/th/settings.json";
import club from "../messages/th/club.json";
import tournament from "../messages/th/tournament.json";
import stats from "../messages/th/stats.json";
import validation from "../messages/th/validation.json";
import actions from "../messages/th/actions.json";
import admin from "../messages/th/admin.json";

const messages = {
  common,
  nav,
  home,
  auth,
  settings,
  club,
  tournament,
  stats,
  validation,
  actions,
  admin,
};

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: "todo",
    },

    // Custom viewport presets mapped to the app's real responsive surfaces
    // (court referee view + public share are phone-first; the TV page targets
    // 1080p). Pick one from the toolbar's viewport icon. The built-in
    // INITIAL_VIEWPORTS (generic phones/tablets) are still available too.
    viewport: {
      options: {
        phone: { name: "Phone (court / public)", styles: { width: "390px", height: "844px" } },
        tablet: { name: "Tablet", styles: { width: "768px", height: "1024px" } },
        desktop: { name: "Desktop", styles: { width: "1280px", height: "800px" } },
        tv: { name: "TV (1080p)", styles: { width: "1920px", height: "1080px" } },
      },
    },
  },
  decorators: [
    // Mirror the app's root providers: i18n (TH) + tooltip context so domain
    // components that call useTranslations / wrap Tooltip render in isolation.
    (Story) => (
      <NextIntlClientProvider
        locale="th"
        messages={messages}
        timeZone="Asia/Bangkok"
      >
        <TooltipProvider delay={300}>
          <Story />
        </TooltipProvider>
      </NextIntlClientProvider>
    ),
  ],
};

export default preview;
