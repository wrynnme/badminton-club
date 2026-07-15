"use server";

/**
 * admin-line-bindings.ts — site-admin actions to inspect + force-unbind every
 * ก๊วน's LINE group binding (spec.md § "📥 User requests" item 3, locked design
 * 2026-07-15). Gated by `isSiteAdmin()` ONLY — this is a site-wide override
 * tool, separate from the per-club `unbindClubLineGroupAction`
 * (`club-linking.ts`) a club manager uses on their own ก๊วน (that one is gated
 * by `assertCanManageClub`).
 *
 * Both mutating actions clear the binding via `clearLineBindingByTarget`
 * (series targets go through `clearBindingBySeriesId`, the both-levels
 * invariant's owner; a legacy orphan clears exactly its own row) and then fire
 * a best-effort LINE 1:1 notice to the ก๊วน owner — never awaited, never
 * allowed to fail the unbind.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { revalidateClubTree } from "@/lib/club/revalidate";
import { getAppSettings } from "@/lib/app-settings";
import { resolveBotMessage } from "@/lib/bot-messages";
import { pushTextToUser } from "@/lib/notification/line-club";
import {
  clearLineBindingByTarget,
  fetchLineBindingInventory,
  type AdminLineBindingRow,
  type AdminLineBindingTarget,
} from "@/lib/club/line-bindings.server";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

const CALLER = "adminUnbindLineGroupAction";

/**
 * Fire-and-forget "your ก๊วน's LINE group was unbound by a site admin" push to
 * the owner — must never block or fail the unbind (locked decision #4). No-op
 * when the owner has no LINE account linked (`profiles.line_user_id` null).
 * Body is the site-admin-editable `adminUnbindNotice` bot-message template.
 */
function fireAdminUnbindNotice(
  sb: AdminClient,
  ownerId: string,
  clubName: string,
  prefetchedMessages?: Awaited<ReturnType<typeof getAppSettings>>["messages"],
): void {
  void (async () => {
    const { data: profile } = await sb
      .from("profiles")
      .select("line_user_id")
      .eq("id", ownerId)
      .maybeSingle();
    const lineUserId = profile?.line_user_id as string | null | undefined;
    if (!lineUserId) return;
    const messages = prefetchedMessages ?? (await getAppSettings()).messages;
    const text = resolveBotMessage(messages, "adminUnbindNotice", { club: clubName });
    await pushTextToUser(lineUserId, text);
  })().catch((err) => console.error(`[${CALLER}] notice push failed`, err));
}

const TargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("series"), seriesId: z.string().uuid() }),
  z.object({ kind: z.literal("legacy"), clubId: z.string().uuid() }),
]);

/**
 * Force-unbind ONE ก๊วน's LINE group (site admin only). Clears both levels,
 * then notifies the owner (fire-and-forget).
 */
export async function adminUnbindLineGroupAction(input: {
  target: AdminLineBindingTarget;
}): Promise<{ ok: true } | { error: string }> {
  const t = await getTranslations("actions");
  if (!(await isSiteAdmin())) return { error: t("admin.notSiteAdmin") };

  const parsed = TargetSchema.safeParse(input.target);
  if (!parsed.success) return { error: t("club.invalidData") };

  const sb = await createAdminClient();
  const result = await clearLineBindingByTarget(sb, parsed.data, CALLER);
  if (!result.ok) return { error: t("club.unbindGroupFailed") };

  fireAdminUnbindNotice(sb, result.ownerId, result.clubName);

  revalidatePath("/admin");
  revalidateClubTree();
  return { ok: true as const };
}

/**
 * Force-unbind EVERY currently-bound ก๊วน's LINE group (site admin only).
 * Best-effort per row — one club's clear failing does not abort the rest (a
 * transient error on club #7 of 20 shouldn't leave the other 19 untouched).
 */
export async function adminUnbindAllLineGroupsAction(): Promise<
  { ok: true; count: number; failed: number } | { error: string }
> {
  const t = await getTranslations("actions");
  if (!(await isSiteAdmin())) return { error: t("admin.notSiteAdmin") };

  const sb = await createAdminClient();
  let rows: AdminLineBindingRow[];
  try {
    rows = await fetchLineBindingInventory(sb);
  } catch (err) {
    console.error("[adminUnbindAllLineGroupsAction] inventory", err);
    return { error: t("club.loadBindingsFailed") };
  }

  // One settings fetch for every notice in the batch (getAppSettings hits the
  // DB per call — mirrors notifyTournamentEvent's hoisted-settings pattern).
  const { messages } = await getAppSettings();

  let count = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await clearLineBindingByTarget(sb, row.target, "adminUnbindAllLineGroupsAction");
    if (result.ok) {
      count++;
      fireAdminUnbindNotice(sb, result.ownerId, result.clubName, messages);
    } else {
      failed++;
    }
  }

  revalidatePath("/admin");
  revalidateClubTree();
  // `failed` lets the client distinguish "all clear" from a partial batch —
  // best-effort per row is by design, silence about failures is not.
  return { ok: true as const, count, failed };
}
