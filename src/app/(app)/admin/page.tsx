import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { QrCode, Gauge, MessageSquareText, MessagesSquare } from "lucide-react";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { getAppSettings, DEFAULT_QR_LOGO } from "@/lib/app-settings";
import { getGlobalLevelsAction } from "@/lib/actions/levels";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchLineBindingInventory } from "@/lib/club/line-bindings.server";
import { Badge } from "@/components/ui/badge";
import { AdminQrLogoManager } from "@/components/admin/admin-qr-logo-manager";
import { AdminLevelsManager } from "@/components/admin/admin-levels-manager";
import { AdminBotMessagesManager } from "@/components/admin/admin-bot-messages-manager";
import { AdminLineBindingsManager } from "@/components/admin/admin-line-bindings-manager";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Site owner only — anyone else sees a 404 (don't reveal the page exists).
  if (!(await isSiteAdmin())) notFound();

  const sb = await createAdminClient();
  const [settings, globalLevels, bindingRows] = await Promise.all([
    getAppSettings(),
    getGlobalLevelsAction(),
    // Page is already isSiteAdmin-gated above — call the inventory directly
    // instead of an action wrapper that would re-run the same gate query.
    fetchLineBindingInventory(sb),
  ]);
  const t = await getTranslations("admin");

  // Quick-nav: one entry per section below, in the same order they render.
  const navItems = [
    { href: "#qr-logo", icon: QrCode, title: t("qrLogoTitle"), desc: t("qrLogoNavDesc") },
    { href: "#levels", icon: Gauge, title: t("levels.title"), desc: t("levels.navDesc") },
    { href: "#bot-messages", icon: MessageSquareText, title: t("botMessages.title"), desc: t("botMessages.navDesc") },
    { href: "#line-bindings", icon: MessagesSquare, title: t("lineBindings.title"), desc: t("lineBindings.navDesc") },
  ];

  return (
    <div className="mx-auto max-w-xl space-y-8 px-4 py-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <Badge variant="secondary">{t("scopeBadge")}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <nav aria-label={t("toolsHeading")}>
        <h2 className="sr-only">{t("toolsHeading")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {navItems.map(({ href, icon: Icon, title, desc }) => (
            <a
              key={href}
              href={href}
              className="flex items-start gap-3 rounded-xl border p-3 text-sm transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{desc}</span>
              </span>
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-6">
        <section id="qr-logo" className="scroll-mt-20">
          <AdminQrLogoManager
            initialEnabled={settings.qr_logo_enabled}
            initialCustomUrl={settings.qr_logo_url}
            defaultLogo={DEFAULT_QR_LOGO}
          />
        </section>
        <section id="levels" className="scroll-mt-20">
          <AdminLevelsManager levels={globalLevels} />
        </section>
        <section id="bot-messages" className="scroll-mt-20">
          <AdminBotMessagesManager initialMessages={settings.messages} />
        </section>
        <section id="line-bindings" className="scroll-mt-20">
          <AdminLineBindingsManager rows={bindingRows} />
        </section>
      </div>
    </div>
  );
}
