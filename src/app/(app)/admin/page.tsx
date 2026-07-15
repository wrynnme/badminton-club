import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { getAppSettings, DEFAULT_QR_LOGO } from "@/lib/app-settings";
import { getGlobalLevelsAction } from "@/lib/actions/levels";
import { listLineBindingsAction } from "@/lib/actions/admin-line-bindings";
import { AdminQrLogoManager } from "@/components/admin/admin-qr-logo-manager";
import { AdminLevelsManager } from "@/components/admin/admin-levels-manager";
import { AdminBotMessagesManager } from "@/components/admin/admin-bot-messages-manager";
import { AdminLineBindingsManager } from "@/components/admin/admin-line-bindings-manager";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Site owner only — anyone else sees a 404 (don't reveal the page exists).
  if (!(await isSiteAdmin())) notFound();

  const [settings, globalLevels, bindingsRes] = await Promise.all([
    getAppSettings(),
    getGlobalLevelsAction(),
    listLineBindingsAction(),
  ]);
  const t = await getTranslations("admin");
  // Page already gated on isSiteAdmin above, so the action should never return
  // its own `{error}` here — default to empty defensively rather than throw.
  const bindingRows = "rows" in bindingsRes ? bindingsRes.rows : [];

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <AdminQrLogoManager
        initialEnabled={settings.qr_logo_enabled}
        initialCustomUrl={settings.qr_logo_url}
        defaultLogo={DEFAULT_QR_LOGO}
      />
      <AdminLevelsManager levels={globalLevels} />
      <AdminBotMessagesManager initialMessages={settings.messages} />
      <AdminLineBindingsManager rows={bindingRows} />
    </div>
  );
}
