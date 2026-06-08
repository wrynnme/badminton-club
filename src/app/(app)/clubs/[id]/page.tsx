import { Suspense } from "react";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays, Clock, MapPin, Users, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClubTabs } from "@/components/club/club-tabs";
import { ClubDashboard } from "@/components/club/club-dashboard";
import { computeClubCostSummary } from "@/lib/club/cost-summary";
import { JoinForm } from "@/components/club/join-form";
import { AddGuestPlayer } from "@/components/club/add-guest-player";
import { EditClubForm } from "@/components/club/edit-club-form";
import { SortablePlayerList } from "@/components/club/sortable-player-list";
import { ExpenseManager } from "@/components/club/expense-manager";
import { ClubCoAdminControls } from "@/components/club/club-co-admin-controls";
import { ClubCostManager } from "@/components/club/club-cost-manager";
import { ClubCostBreakdown } from "@/components/club/club-cost-breakdown";
import { HourlyHeadcount } from "@/components/club/hourly-headcount";
import { ClubQueueSettings } from "@/components/club/club-queue-settings";
import { ClubCourtManager } from "@/components/club/club-court-manager";
import { ClubQueuePanel } from "@/components/club/club-queue-panel";
import { ClubLockedPairs } from "@/components/club/club-locked-pairs";
import { parseQueueSettings } from "@/lib/club/queue-settings";
import type { ClubExpense, ClubAdmin } from "@/lib/actions/clubs";
import type { ClubMatch, ClubLockedPair, Level } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ClubDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createAdminClient();
  const session = await getSession();

  const { data: club } = await sb
    .from("clubs")
    .select("*")
    .eq("id", id)
    .single();

  if (!club) notFound();

  const [ownerRes, playersRes, expensesRes, adminsRes, matchesRes, lockedPairsRes, levelsRes] = await Promise.all([
    sb.from("profiles").select("display_name, picture_url").eq("id", club.owner_id).single(),
    sb
      .from("club_players")
      .select("*")
      .eq("club_id", id)
      .order("position", { ascending: true, nullsFirst: false })
      .order("joined_at", { ascending: true }),
    sb
      .from("club_expenses")
      .select("*")
      .eq("club_id", id)
      .order("created_at", { ascending: true }),
    sb
      .from("club_admins")
      .select("club_id, user_id, added_by, added_at, profile:profiles!club_admins_user_id_fkey(display_name, line_user_id)")
      .eq("club_id", id)
      .order("added_at", { ascending: true }),
    sb
      .from("club_matches")
      .select("*")
      .eq("club_id", id)
      .order("queue_position", { ascending: true, nullsFirst: false }),
    sb
      .from("club_locked_pairs")
      .select("*")
      .eq("club_id", id)
      .order("created_at", { ascending: true }),
    sb
      .from("levels")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("real", { ascending: true }),
  ]);

  const owner = ownerRes.data;
  const players = playersRes.data ?? [];
  const expenses: ClubExpense[] = (expensesRes.data ?? []) as ClubExpense[];
  const clubMatches: ClubMatch[] = (matchesRes.data ?? []) as ClubMatch[];
  const lockedPairs: ClubLockedPair[] = (lockedPairsRes.data ?? []) as ClubLockedPair[];
  const levels: Level[] = (levelsRes.data ?? []) as Level[];

  type AdminRow = { club_id: string; user_id: string; added_by: string | null; added_at: string; profile: { display_name: string | null; line_user_id: string | null } | null };
  const coAdmins: ClubAdmin[] = ((adminsRes.data ?? []) as unknown as AdminRow[]).map((r) => ({
    club_id: r.club_id,
    user_id: r.user_id,
    display_name: r.profile?.display_name ?? null,
    line_user_id: r.profile?.line_user_id ?? null,
    added_by: r.added_by,
    added_at: r.added_at,
  }));

  const joined = players.length;
  const activeCount = players.filter((p) => p.status === "active").length;
  const reserveCount = players.filter((p) => p.status === "reserve").length;
  const full = activeCount >= club.max_players;
  const myRow = session
    ? players.find((p) => p.profile_id === session.profileId)
    : null;
  const isOwner = session?.profileId === club.owner_id;
  const isCoAdmin = session ? coAdmins.some((a) => a.user_id === session.profileId) : false;
  const canManage = isOwner || isCoAdmin;

  const queueSettings = parseQueueSettings(club.queue_settings);

  // Named courts (clubs.courts). Fall back to ['1'..'N'] derived from the legacy
  // queue_settings.court_count so the queue UI works before the named-courts
  // migration is applied / for clubs that have never set a court list. Once an
  // owner saves a list (or the backfill runs) club.courts becomes the source.
  const clubCourts =
    club.courts && club.courts.length > 0
      ? club.courts
      : Array.from({ length: queueSettings.court_count }, (_, i) => String(i + 1));

  // Compute total from expenses; fall back to legacy total_cost
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const displayTotal = expenseTotal > 0 ? expenseTotal : (club.total_cost ?? 0);

  // Canonical session cost (court + shuttle + personal expenses − discounts) —
  // same calc the cost-breakdown table uses, so the dashboard card reconciles.
  const costSummary = computeClubCostSummary({ club, players, matches: clubMatches, expenses });

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-2xl font-bold">{club.name}</h1>
          <div className="flex items-center gap-1.5">
            {full ? (
              <Badge variant="destructive">เต็ม</Badge>
            ) : (
              <Badge variant="secondary">{activeCount}/{club.max_players}</Badge>
            )}
            {reserveCount > 0 && (
              <Badge variant="outline" className="text-muted-foreground">
                +{reserveCount} สำรอง
              </Badge>
            )}
          </div>
        </div>
        {owner && (
          <p className="text-sm text-muted-foreground mt-1">โดย {owner.display_name}</p>
        )}
      </div>

      <Card>
        <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
          <Info label={<MapPin className="h-4 w-4" />} text={club.venue} />
          <Info
            label={<CalendarDays className="h-4 w-4" />}
            text={format(new Date(club.play_date), "EEE d MMM yyyy")}
          />
          <Info
            label={<Clock className="h-4 w-4" />}
            text={`${club.start_time.slice(0, 5)} – ${club.end_time.slice(0, 5)}`}
          />
          <Info
            label={<Users className="h-4 w-4" />}
            text={`${activeCount}${reserveCount > 0 ? ` (+${reserveCount} สำรอง)` : ""} / ${club.max_players} คน`}
          />
          {displayTotal > 0 && (
            <Info
              label={<Wallet className="h-4 w-4" />}
              text={`รวมค่าใช้จ่าย ${displayTotal.toLocaleString()} บาท`}
            />
          )}
          {club.shuttle_info && <Info label="🏸" text={club.shuttle_info} />}
        </CardContent>
      </Card>

      {club.notes && (
        <Card>
          <CardHeader><CardTitle className="text-base">หมายเหตุ</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{club.notes}</CardContent>
        </Card>
      )}

      <Suspense fallback={null}>
        <ClubTabs
          showSettings={canManage}
          dashboard={
            <ClubDashboard
              players={players}
              matches={clubMatches}
              levels={levels}
              costTotal={costSummary.grandTotal}
              maxPlayers={club.max_players}
            />
          }
          checkin={
            <div className="space-y-6">
              <section className="space-y-3">
                <h2 className="font-semibold">ลงชื่อเล่น</h2>
                {!session ? (
                  <p className="text-sm text-muted-foreground">
                    <a href="/" className="underline">เข้าสู่ระบบ</a> ก่อนลงชื่อ
                  </p>
                ) : (
                  <JoinForm
                    clubId={club.id}
                    defaultName={session.displayName}
                    full={full}
                    alreadyJoined={!!myRow}
                    levels={levels}
                  />
                )}
              </section>

              <section className="space-y-2">
                <h2 className="font-semibold">รายชื่อผู้เล่น ({joined})</h2>
                {canManage && <AddGuestPlayer clubId={club.id} full={full} levels={levels} />}
                <SortablePlayerList
                  clubId={club.id}
                  players={players}
                  sessionProfileId={session?.profileId ?? null}
                  canManage={canManage}
                  levels={levels}
                  sessionStart={club.start_time}
                  sessionEnd={club.end_time}
                />
              </section>

              {players.length > 0 && (
                <section className="space-y-2">
                  <h2 className="font-semibold">จำนวนคนต่อช่วง</h2>
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
                  players={players.map((p) => ({ id: p.id, display_name: p.display_name }))}
                  locks={lockedPairs}
                  canManage={canManage}
                />
              )}
              <ClubQueuePanel
                clubId={club.id}
                matches={clubMatches}
                players={players.map((p) => ({ id: p.id, display_name: p.display_name }))}
                settings={queueSettings}
                courts={clubCourts}
                canManage={canManage}
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
                      ค่าใช้จ่ายส่วนบุคคล
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
                    court_gap_policy: club.court_gap_policy,
                  }}
                />
              )}

              {(club.court_fee > 0 ||
                club.shuttle_price > 0 ||
                expenses.length > 0 ||
                players.some((p) => p.discount > 0)) ? (
                <section className="space-y-2">
                  <h2 className="font-semibold">สรุปค่าใช้จ่าย</h2>
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
                  <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลค่าใช้จ่าย</p>
                )
              )}
            </div>
          }
          settings={
            <div className="space-y-4">
              {isOwner && <EditClubForm club={club} />}
              {canManage && <ClubCourtManager clubId={club.id} initialCourts={clubCourts} />}
              {canManage && <ClubQueueSettings clubId={club.id} initial={queueSettings} />}
              {isOwner && <ClubCoAdminControls clubId={club.id} initialAdmins={coAdmins} />}
            </div>
          }
        />
      </Suspense>
    </div>
  );
}

function Info({ label, text }: { label: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{text}</span>
    </div>
  );
}
