"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RotateCcw, Save, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BOT_MESSAGE_KEYS,
  BOT_MESSAGE_SPECS,
  BOT_MESSAGE_SAMPLE_VARS,
  DEFAULT_BOT_MESSAGES,
  renderBotMessage,
  missingRequiredPlaceholders,
  type BotMessageKey,
} from "@/lib/bot-messages";
import { updateBotMessagesAction } from "@/lib/actions/app-settings";

// Site-admin editor for the bot's automated LINE messages. Each message is a
// template with `{placeholder}` slots; a blank field falls back to the code
// default (the bot can never go silent). Live preview + per-field reset + a
// single global save. Required-placeholder validation mirrors the server action.

type Drafts = Record<BotMessageKey, string>;

export function AdminBotMessagesManager({
  initialMessages,
}: {
  initialMessages: Partial<Record<BotMessageKey, string>>;
}) {
  const t = useTranslations("admin.botMessages");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Drafts>(
    () =>
      Object.fromEntries(
        BOT_MESSAGE_KEYS.map((k) => [k, initialMessages[k] ?? ""]),
      ) as Drafts,
  );

  // Per-field: which required placeholders a non-blank override is missing.
  const missingByKey = useMemo(() => {
    const out = {} as Record<BotMessageKey, string[]>;
    for (const k of BOT_MESSAGE_KEYS) {
      const text = drafts[k].trim();
      out[k] = text.length > 0 ? missingRequiredPlaceholders(k, text) : [];
    }
    return out;
  }, [drafts]);

  const anyInvalid = BOT_MESSAGE_KEYS.some((k) => missingByKey[k].length > 0);

  function setDraft(key: BotMessageKey, value: string) {
    setDrafts((d) => ({ ...d, [key]: value }));
  }

  function handleSave() {
    if (anyInvalid) return;
    start(async () => {
      const res = await updateBotMessagesAction({ messages: drafts });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("saved"));
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="h-4 w-4" />
          {t("title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {BOT_MESSAGE_KEYS.map((key) => {
          const draft = drafts[key];
          const isDefault = draft.trim().length === 0;
          const missing = missingByKey[key];
          const required = BOT_MESSAGE_SPECS[key].required;
          const preview = renderBotMessage(
            isDefault ? DEFAULT_BOT_MESSAGES[key] : draft,
            BOT_MESSAGE_SAMPLE_VARS[key],
          );
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`bot-msg-${key}`} className="text-sm font-medium">
                  {t(`label.${key}`)}
                </label>
                <div className="flex items-center gap-2">
                  {isDefault && (
                    <span className="text-[11px] text-muted-foreground">{t("usingDefault")}</span>
                  )}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          disabled={pending || isDefault}
                          onClick={() => setDraft(key, "")}
                          aria-label={t("resetTooltip")}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                    <TooltipContent>{t("resetTooltip")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {required.length > 0 && (
                <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  <span>{t("requiredLabel")}</span>
                  {required.map((r) => (
                    <code
                      key={r}
                      className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]"
                    >{`{${r}}`}</code>
                  ))}
                </p>
              )}

              <Textarea
                id={`bot-msg-${key}`}
                value={draft}
                onChange={(e) => setDraft(key, e.target.value)}
                placeholder={DEFAULT_BOT_MESSAGES[key]}
                rows={Math.min(4, DEFAULT_BOT_MESSAGES[key].split("\n").length + 1)}
                className="text-sm font-mono"
                aria-invalid={missing.length > 0}
              />

              {missing.length > 0 && (
                <p className="text-[11px] text-destructive">
                  {t("missingError", { missing: missing.map((m) => `{${m}}`).join(", ") })}
                </p>
              )}

              <div className="rounded-md border bg-muted/40 px-2.5 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("previewLabel")}
                </p>
                <p className="whitespace-pre-wrap text-xs">{preview}</p>
              </div>
            </div>
          );
        })}

        <div className="flex justify-end border-t pt-3">
          <Button size="sm" disabled={pending || anyInvalid} onClick={handleSave}>
            <Save className="mr-1.5 h-4 w-4" />
            {pending ? t("saving") : t("saveButton")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
