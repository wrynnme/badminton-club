import { getRequestConfig } from "next-intl/server";
import { NAMESPACES } from "./config";
import { getUserLocale } from "./locale";

// Composes the message catalog from per-namespace files
// (messages/<locale>/<ns>.json) so namespaces can be authored in parallel
// without contending on one shared file. Each namespace becomes a top-level
// key, so components call useTranslations("club"), getTranslations("nav"), …
export default getRequestConfig(async () => {
  const locale = await getUserLocale();

  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const mod = await import(`../../messages/${locale}/${ns}.json`);
      return [ns, mod.default] as const;
    }),
  );

  return {
    locale,
    messages: Object.fromEntries(entries),
  };
});
