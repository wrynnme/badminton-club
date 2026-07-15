import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays, Clock, MapPin, Users, Wallet } from "lucide-react";
import { getLocale } from "next-intl/server";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClubTabs } from "@/components/club/club-tabs";
import { ClubDashboard } from "@/components/club/club-dashboard";
import { computeClubCostSummary, buildHourlyShuttleSlots } from "@/lib/club/cost-summary";
import { AddGuestPlayer } from "@/components/club/add-guest-player";
import { LineImportDialog } from "@/components/club/line-import-dialog";
import { EditClubForm } from "@/components/club/edit-club-form";
import { SortablePlayerList } from "@/components/club/sortable-player-list";
import { ExpenseManager } from "@/components/club/expense-manager";
import { ClubCoAdminControls } from "@/components/club/club-co-admin-controls";
import { DeleteClubButton } from "@/components/club/delete-club-button";
import { ClubVisibilityControls } from "@/components/club/club-visibility-controls";
import { ClubCostManager } from "@/components/club/club-cost-manager";
import { ClubCostBreakdown } from "@/components/club/club-cost-breakdown";
import { ClubPaymentCollector } from "@/components/club/club-payment-collector";
import { HourlyHeadcount } from "@/components/club/hourly-headcount";
import { ClubQueueSettings } from "@/components/club/club-queue-settings";
import { ClubCourtManager } from "@/components/club/club-court-manager";
import { ClubLevelsManager } from "@/components/club/club-levels-manager";
import { ClubQueuePanel } from "@/components/club/club-queue-panel";
import { ClubLockedPairs } from "@/components/club/club-locked-pairs";
import { ClubLiveWrapper } from "@/components/club/club-live-wrapper";
import { SaveClubAsPresetDialog } from "@/components/club/save-club-as-preset-dialog";
import { UpgradeAdhocCard } from "@/components/club/upgrade-adhoc-card";
import { parseQueueSettings } from "@/lib/club/queue-settings";
import { hasBankReceiver, parseReceiptTemplate } from "@/lib/club/receipt";
import { resolveClubCourts } from "@/lib/club/courts";
import { ClubInfoRow } from "@/components/club/club-info-row";
import { getTranslations } from "next-intl/server";
import { getClubLevelsAction } from "@/lib/actions/levels";
import { getAppSettings, resolveQrLogoUrl } from "@/lib/app-settings";
import { resolveBotMessage } from "@/lib/bot-messages";
import { resolveLineGroupId } from "@/lib/club/series.server";
import type { ClubExpense } from "@/lib/actions/club-cost";
import type { ClubAdmin } from "@/lib/actions/club-admins";
import type { ClubMatch, ClubLockedPair, Level, ClubPreset, ClubSeries } from "@/lib/types";

export async function ClubSessionView({ clubId }: { clubId: string }) {
  const sb = await createAdminClient();
  // getSession() does its own profiles round-trip (session_version check), so run
  // it in parallel with the club fetch instead of serially (matches the tournament
  // page's Promise.all([getSession(), …]) pattern).
  const [session, clubRes] = await Promise.all([
    getSession(),
    sb.from("clubs").select("*").eq("id", clubId).single(),
  ]);
  const club = clubRes.data;

  if (!club) notFound();

  const [ownerRes, playersRes, expensesRes, adminsRes, matchesRes, lockedPairsRes, levelsRes, appSettings, presetsRes, lineRes, seriesRes] = await Promise.all([
    sb.from("profiles").select("display_name, picture_url").eq("id", club.owner_id).single(),
    sb
      .from("club_players")
      .select("*")
      .eq("club_id", clubId)
      .order("position", { ascending: true, nullsFirst: false })
      .order("joined_at", { ascending: true }),
    sb
      .from("club_expenses")
      .select("*")
      .eq("club_id", clubId)
      .order("created_at", { ascending: true }),
    sb
      .from("club_admins")
      .select("club_id, user_id, added_by, added_at, profile:profiles!club_admins_user_id_fkey(display_name, line_user_id)")
      .eq("club_id", clubId)
      .order("added_at", { ascending: true }),
    sb
      .from("club_matches")
      .select("*")
      .eq("club_id", clubId)
      // created_at tiebreak: no DB unique constraint on queue_position, so concurrent
      // tail-inserts can collide on the same position → order them deterministically by
      // insert time instead of arbitrarily (matches byQueueThenCreated in the panel).
      .order("queue_position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    sb
      .from("club_locked_pairs")
      .select("*")
      .eq("club_id", clubId)
      .order("created_at", { ascending: true }),
    getClubLevelsAction(clubId),
    getAppSettings(),
    // SaveClubAsPresetDialog only needs id+name for its target <Select>; the
    // full-config consumer (PresetManager) lives on /clubs/mine instead.
    session && !session.isGuest
      ? sb
          .from("club_presets")
          .select("id, name")
          .eq("owner_id", session.profileId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
    // Line reachability for ClubPaymentCollector (cost tab). Narrow join fetched
    // in-wave (parallel) instead of a serial post-wave lookup; this array stays
    // server-side — only the derived id list ships to the client, never line_user_id.
    sb
      .from("club_players")
      .select("id, profile:profiles!club_players_profile_id_fkey(line_user_id)")
      .eq("club_id", clubId),
    // Club series (ADR 0002 P1) — already-fetched club.series_id avoids a second
    // round-trip through getSeriesForClub's own clubs lookup. null series_id (a
    // club created between backfill and this ship) stays null below — a GET
    // render must never mutate (E), so no ensureSeriesForClub fallback here.
    club.series_id
      ? sb.from("club_series").select("*").eq("id", club.series_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const owner = ownerRes.data;
  const players = playersRes.data ?? [];
  const expenses: ClubExpense[] = (expensesRes.data ?? []) as ClubExpense[];
  const clubMatches: ClubMatch[] = (matchesRes.data ?? []) as ClubMatch[];
  const lockedPairs: ClubLockedPair[] = (lockedPairsRes.data ?? []) as ClubLockedPair[];
  const levels: Level[] = levelsRes;
  const isCustomized = levels.some((l) => l.club_id != null);

  type AdminRow = { club_id: string; user_id: string; added_by: string | null; added_at: string; profile: { display_name: string | null; line_user_id: string | null } | null };
  const coAdmins: ClubAdmin[] = ((adminsRes.data ?? []) as unknown as AdminRow[]).map((r) => ({
    club_id: r.club_id,
    user_id: r.user_id,
    display_name: r.profile?.display_name ?? null,
    line_user_id: r.profile?.line_user_id ?? null,
    added_by: r.added_by,
    added_at: r.added_at,
  }));

  // Which players have a linked LINE account — used by ClubPaymentCollector for
  // reachability badges + the "Bill via LINE" button. lineRes is fetched in the
  // wave above; only the derived id list (never line_user_id) reaches the client.
  type LineRow = { id: string; profile: { line_user_id: string | null } | null };
  const lineReachableIds: string[] = ((lineRes.data ?? []) as unknown as LineRow[])
    .filter((r) => r.profile?.line_user_id)
    .map((r) => r.id);

  const joined = players.length;
  const activeCount = players.filter((p) => p.status === "active").length;
  const reserveCount = players.filter((p) => p.status === "reserve").length;
  const full = activeCount >= club.max_players;
  const isOwner = session?.profileId === club.owner_id;
  const isCoAdmin = session ? coAdmins.some((a) => a.user_id === session.profileId) : false;
  const canManage = isOwner || isCoAdmin;

  // Clubs are owner/co-admin only — non-managers can't view the club at all.
  // Not logged in → login (return here after); logged-in non-manager → club list.
  if (!canManage) {
    if (!session) {
      redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(`/clubs/${club.id}`)}`);
    }
    redirect("/clubs");
  }

  // ADR 0002 P1 — this club's series (E — read-only; a GET render must never
  // mutate). `seriesRes` covers the normal case (club.series_id already set, all
  // 8 prod clubs post-backfill); a club created between backfill and this ship
  // stays null here (the lazy `ensureSeriesForClub` migration only runs from a
  // mutating action, e.g. generateClubJoinTokenAction) — `resolveLineGroupId`
  // already tolerates a null series. The LINE join-link + link pool UI moved to
  // the series settings tab in C2 (`series-home.tsx`) — this page only still
  // needs the resolved group-binding flag for `ClubPaymentCollector`.
  const series: ClubSeries | null = (seriesRes.data as ClubSeries | null) ?? null;
  const resolvedLineGroupId = resolveLineGroupId(series, club);

  const ownedPresets: Pick<ClubPreset, "id" | "name">[] = (presetsRes.data ?? []).map(
    (row) => ({ id: row.id as string, name: row.name as string }),
  );

  const queueSettings = parseQueueSettings(club.queue_settings);

  // Named courts (clubs.courts), else a legacy ['1'..'N'] fallback (see resolveClubCourts).
  const clubCourts = resolveClubCourts(club.courts, queueSettings.court_count);

  // Canonical session cost (court + shuttle + personal expenses − discounts) —
  // same calc the cost-breakdown table uses, so the dashboard card reconciles.
  const costSummary = computeClubCostSummary({ club, players, matches: clubMatches, expenses });

  // One headline cost number shared by the page header AND the dashboard card, so
  // they never disagree. Prefer the computed session total; fall back to legacy
  // total_cost only before any court/shuttle/expense/discount input is set.
  const clubCostTotal = costSummary.grandTotal > 0 ? costSummary.grandTotal : (club.total_cost ?? 0);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const locale = await getLocale();
  const t = await getTranslations("club");
  const receiptTemplate = parseReceiptTemplate(club.receipt_template);
  const presetSummary = {
    coAdminCount: coAdmins.length,
    regularCount: players.length,
    hasPromptPay: Boolean(club.promptpay_id),
    hasQrImage: Boolean(club.promptpay_qr_image),
    hasBank: hasBankReceiver(receiptTemplate.bank),
    themeLabel: t(`receipt.theme_${receiptTemplate.theme}`),
  };

  return (
    <ClubLiveWrapper clubId={club.id} realtimeEnabled={queueSettings.realtime_enabled}>
    <div className="space-y-6 max-w-3xl mx-auto">
      {series && !series.is_adhoc && (
        <Link href={`/clubs/${series.id}`} className="text-sm text-muted-foreground hover:text-foreground">
          {t("page.backToSeries", { name: series.name })}
        </Link>
      )}
      <div>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-2xl font-bold">{club.name}</h1>
          <div className="flex items-center gap-1.5">
            {full ? (
              <Badge variant="destructive">{t("page.full")}</Badge>
            ) : (
              <Badge variant="secondary">{activeCount}/{club.max_players}</Badge>
            )}
            {reserveCount > 0 && (
              <Badge variant="outline" className="text-muted-foreground">
                {t("page.reserveBadge", { count: reserveCount })}
              </Badge>
            )}
          </div>
        </div>
        {owner && (
          <p className="text-sm text-muted-foreground mt-1">{t("page.by", { name: owner.display_name })}</p>
        )}
      </div>

      <Card>
        <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
          <ClubInfoRow label={<MapPin className="h-4 w-4" />} text={club.venue} />
          <ClubInfoRow
            label={<CalendarDays className="h-4 w-4" />}
            text={format(new Date(club.play_date), "EEE d MMM yyyy", { locale: dateFnsLocaleOf(locale) })}
          />
          <ClubInfoRow
            label={<Clock className="h-4 w-4" />}
            text={`${club.start_time.slice(0, 5)} – ${club.end_time.slice(0, 5)}`}
          />
          <ClubInfoRow
            label={<Users className="h-4 w-4" />}
            text={`${activeCount}${reserveCount > 0 ? ` ${t("page.reserveSuffix", { count: reserveCount })}` : ""} ${t("page.playerCountSuffix", { max: club.max_players })}`}
          />
          {clubCostTotal > 0 && (
            <ClubInfoRow
              label={<Wallet className="h-4 w-4" />}
              text={t("page.totalCostInfo", { total: clubCostTotal.toLocaleString() })}
            />
          )}
          {club.shuttle_info && <ClubInfoRow label="🏸" text={club.shuttle_info} />}
        </CardContent>
      </Card>

      {club.notes && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t("page.notes")}</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{club.notes}</CardContent>
        </Card>
      )}

      <Suspense fallback={null}>
        <ClubTabs
          showSettings={canManage}
          dashboard={
            <ClubDashboard
              club={club}
              players={players}
              matches={clubMatches}
              levels={levels}
              expenses={expenses}
              costTotal={clubCostTotal}
              maxPlayers={club.max_players}
            />
          }
          checkin={
            <div className="space-y-6">
              <section className="space-y-2">
                <h2 className="font-semibold">{t("page.playerListHeading", { count: joined })}</h2>
                <SortablePlayerList
                  clubId={club.id}
                  players={players}
                  sessionProfileId={session?.profileId ?? null}
                  canManage={canManage}
                  levels={levels}
                  sessionStart={club.start_time}
                  sessionEnd={club.end_time}
                  headerActions={
                    canManage ? (
                      <>
                        <AddGuestPlayer
                          clubId={club.id}
                          full={full}
                          levels={levels}
                          sessionStart={club.start_time}
                          sessionEnd={club.end_time}
                        />
                        <LineImportDialog
                          clubId={club.id}
                          existingNames={players.map((p) => p.display_name)}
                        />
                      </>
                    ) : null
                  }
                />
              </section>

              {players.length > 0 && (
                <section className="space-y-2">
                  <h2 className="font-semibold">{t("page.headcountHeading")}</h2>
                  <HourlyHeadcount club={club} players={players} />
                </section>
              )}
            </div>
          }
          queue={
            <div className="space-y-4">
              {queueSettings.players_per_team === 2 && (
                <ClubLockedPairs
                  clubId={club.id}
                  players={players.map((p) => ({
                    id: p.id,
                    display_name: p.display_name,
                    start_time: p.start_time,
                    end_time: p.end_time,
                    checked_in_at: p.checked_in_at,
                  }))}
                  locks={lockedPairs}
                  matches={clubMatches}
                  canManage={canManage}
                  clubStart={String(club.start_time).slice(0, 5)}
                  clubEnd={String(club.end_time).slice(0, 5)}
                />
              )}
              <ClubQueuePanel
                clubId={club.id}
                matches={clubMatches}
                players={players.map((p) => ({
                  id: p.id,
                  display_name: p.display_name,
                  status: p.status,
                  checked_in_at: p.checked_in_at,
                  start_time: p.start_time,
                  end_time: p.end_time,
                }))}
                locks={lockedPairs}
                settings={queueSettings}
                courts={clubCourts}
                canManage={canManage}
                clubStart={String(club.start_time).slice(0, 5)}
                clubEnd={String(club.end_time).slice(0, 5)}
              />
            </div>
          }
          cost={
            <div className="space-y-4">
              {canManage && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wallet className="h-4 w-4" />
                      {t("page.expensePersonalTitle")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ExpenseManager
                      clubId={club.id}
                      expenses={expenses}
                      playerCount={joined}
                      players={players.map((p) => ({ id: p.id, display_name: p.display_name }))}
                    />
                  </CardContent>
                </Card>
              )}

              {canManage && (
                <ClubCostManager
                  clubId={club.id}
                  initial={{
                    court_fee: club.court_fee,
                    court_split: club.court_split,
                    shuttle_split: club.shuttle_split,
                    shuttle_price: club.shuttle_price,
                    shuttle_hourly: club.shuttle_hourly ?? [],
                    shuttle_total: club.shuttle_total ?? 0,
                    court_gap_policy: club.court_gap_policy,
                  }}
                  hourlySlots={buildHourlyShuttleSlots(club, players)}
                />
              )}

              {(club.court_fee > 0 ||
                club.shuttle_price > 0 ||
                expenses.length > 0 ||
                players.some((p) => p.discount > 0)) ? (
                <section className="space-y-2">
                  <h2 className="font-semibold">{t("page.expenseSummaryHeading")}</h2>
                  <Card>
                    <CardContent className="pt-4">
                      <ClubCostBreakdown
                        club={club}
                        players={players}
                        matches={clubMatches}
                        expenses={expenses}
                        canManage={canManage}
                        clubId={club.id}
                      />
                    </CardContent>
                  </Card>
                </section>
              ) : (
                !canManage && (
                  <p className="text-sm text-muted-foreground">{t("page.expenseEmpty")}</p>
                )
              )}

              {canManage && (
                <ClubPaymentCollector
                  clubId={club.id}
                  club={club}
                  players={players}
                  matches={clubMatches}
                  expenses={expenses}
                  qrLogoUrl={resolveQrLogoUrl(appSettings)}
                  scanPrompt={resolveBotMessage(appSettings.messages, "groupBillScanPrompt")}
                  lineReachableIds={lineReachableIds}
                  lineGroupBound={!!resolvedLineGroupId}
                />
              )}
            </div>
          }
          settings={
            <div className="space-y-4">
              {canManage && session && !session.isGuest && (
                <Card>
                  <CardContent>
                    <SaveClubAsPresetDialog
                      clubId={club.id}
                      defaultName={club.name}
                      presets={ownedPresets}
                      summary={presetSummary}
                    />
                  </CardContent>
                </Card>
              )}
              {isOwner && <EditClubForm club={club} />}
              {isOwner && (
                <ClubVisibilityControls clubId={club.id} isPublic={club.is_public} appUrl={appUrl} />
              )}
              {canManage && <ClubCourtManager clubId={club.id} initialCourts={clubCourts} />}
              {canManage && <ClubQueueSettings clubId={club.id} initial={queueSettings} />}
              {/* Levels card only when skill levels are in use (queue_mode = level_match);
                  skill_level_enabled tracks that. Hidden otherwise so managers aren't
                  shown a level editor that has no effect on their queue. */}
              {canManage && queueSettings.skill_level_enabled && (
                <ClubLevelsManager
                  levels={levels}
                  clubId={club.id}
                  isCustomized={isCustomized}
                />
              )}
              {/* ADR 0002 C2 — the LINE join-link + link pool moved to the series
                  settings tab (`series-home.tsx`); it now lives once per ก๊วน
                  instead of per นัด. An ad-hoc series (decision #12) still gets
                  the upgrade offer here instead, since it has no series home a
                  manager would otherwise navigate to. */}
              {canManage && series && series.is_adhoc && <UpgradeAdhocCard seriesId={series.id} />}
              {isOwner && <ClubCoAdminControls clubId={club.id} initialAdmins={coAdmins} />}
              {isOwner && (
                <div className="border-t border-destructive/30 pt-4 mt-2 space-y-3">
                  <h2 className="font-semibold text-destructive">{t("page.dangerZoneHeading")}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t("page.dangerZoneDesc")}
                  </p>
                  <DeleteClubButton clubId={club.id} clubName={club.name} />
                </div>
              )}
            </div>
          }
        />
      </Suspense>
    </div>
    </ClubLiveWrapper>
  );
}
