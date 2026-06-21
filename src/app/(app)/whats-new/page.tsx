import { getTranslations } from "next-intl/server";
import { getLocale } from "next-intl/server";
import { format, parseISO } from "date-fns";
import { Sparkles, Wrench, Bug } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHANGELOG, CURRENT_VERSION, type ChangelogGroupType } from "@/lib/changelog";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";

export const metadata = {
  title: "มีอะไรใหม่",
};

function groupIcon(type: ChangelogGroupType) {
  if (type === "new") return Sparkles;
  if (type === "improved") return Wrench;
  return Bug;
}

function groupColorClass(type: ChangelogGroupType) {
  if (type === "new") return "text-primary";
  if (type === "improved") return "text-blue-500";
  return "text-orange-500";
}

function groupBadgeVariant(type: ChangelogGroupType): "default" | "secondary" | "outline" {
  if (type === "new") return "default";
  if (type === "improved") return "secondary";
  return "outline";
}

export default async function WhatsNewPage() {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const dateFnsLocale = dateFnsLocaleOf(locale);

  const groupLabel: Record<ChangelogGroupType, string> = {
    new: t("changelogNew"),
    improved: t("changelogImproved"),
    fixed: t("changelogFixed"),
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("whatsNewTitle")}</h1>
          <Badge variant="secondary" className="font-mono text-xs">
            v{CURRENT_VERSION}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t("whatsNewSubtitle")}</p>
      </div>

      {/* Timeline */}
      <div className="relative space-y-6">
        {/* Vertical line */}
        <div
          className="absolute left-3 top-2 bottom-2 w-px bg-border"
          aria-hidden="true"
        />

        {CHANGELOG.map((entry) => {
          const dateLabel = format(parseISO(entry.date), "d MMMM yyyy", {
            locale: dateFnsLocale,
          });

          return (
            <div key={entry.version} className="relative pl-10">
              {/* Timeline dot */}
              <div
                className="absolute left-0 top-1.5 h-6 w-6 rounded-full border-2 border-primary bg-background flex items-center justify-center"
                aria-hidden="true"
              >
                <div className="h-2 w-2 rounded-full bg-primary" />
              </div>

              {/* Version + date label */}
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  v{entry.version}
                </Badge>
                <span className="text-sm font-semibold text-muted-foreground">
                  {dateLabel}
                </span>
              </div>

              {/* Groups */}
              <Card>
                <CardContent className="divide-y divide-border px-0 py-0">
                  {entry.groups.map((group, gi) => {
                    const Icon = groupIcon(group.type);
                    const colorClass = groupColorClass(group.type);
                    const badgeVariant = groupBadgeVariant(group.type);

                    return (
                      <div key={gi} className="px-5 py-4 space-y-2.5">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 shrink-0 ${colorClass}`} />
                          <Badge variant={badgeVariant} className="text-xs">
                            {groupLabel[group.type]}
                          </Badge>
                        </div>
                        <ul className="space-y-1.5 pl-1">
                          {group.items.map((item, ii) => (
                            <li
                              key={ii}
                              className="flex gap-2 text-sm leading-relaxed text-foreground/90"
                            >
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <p className="text-center text-xs text-muted-foreground/60">
        {t("changelogFooter")}
      </p>
    </div>
  );
}
