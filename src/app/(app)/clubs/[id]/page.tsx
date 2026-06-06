import { notFound } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays, Clock, MapPin, Users, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { ClubQueuePanel } from "@/components/club/club-queue-panel";
import { parseQueueSettings } from "@/lib/club/queue-settings";
import type { ClubExpense, ClubAdmin } from "@/lib/actions/clubs";
import type { ClubMatch } from "@/lib/types";

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

  const [ownerRes, playersRes, expensesRes, adminsRes, matchesRes] = await Promise.all([
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
  ]);

  const owner = ownerRes.data;
  const players = playersRes.data ?? [];
  const expenses: ClubExpense[] = (expensesRes.data ?? []) as ClubExpense[];
  const clubMatches: ClubMatch[] = (matchesRes.data ?? []) as ClubMatch[];

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
  const full = joined >= club.max_players;
  const myRow = session
    ? players.find((p) => p.profile_id === session.profileId)
    : null;
  const isOwner = session?.profileId === club.owner_id;
  const isCoAdmin = session ? coAdmins.some((a) => a.user_id === session.profileId) : false;
  const canManage = isOwner || isCoAdmin;

  const queueSettings = parseQueueSettings(club.queue_settings);

  // Compute total from expenses; fall back to legacy total_cost
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const displayTotal = expenseTotal > 0 ? expenseTotal : (club.total_cost ?? 0);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-2xl font-bold">{club.name}</h1>
          {full ? (
            <Badge variant="destructive">เต็ม</Badge>
          ) : (
            <Badge variant="secondary">{joined}/{club.max_players}</Badge>
          )}
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
            text={`${joined} / ${club.max_players} คน`}
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

      {isOwner && (
        <div className="space-y-4">
          <EditClubForm club={club} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                ค่าใช้จ่าย
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

          <ClubCostManager
            clubId={club.id}
            initial={{
              court_fee: club.court_fee,
              court_split: club.court_split,
              shuttle_fee: club.shuttle_fee,
              shuttle_split: club.shuttle_split,
              court_gap_policy: club.court_gap_policy,
            }}
          />

          <ClubCoAdminControls clubId={club.id} initialAdmins={coAdmins} />
        </div>
      )}

      {canManage && (
        <ClubQueueSettings clubId={club.id} initial={queueSettings} />
      )}

      <Separator />

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
          />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">รายชื่อผู้เล่น ({joined})</h2>
        {canManage && <AddGuestPlayer clubId={club.id} full={full} />}
        <SortablePlayerList
          clubId={club.id}
          players={players}
          sessionProfileId={session?.profileId ?? null}
          canManage={canManage}
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

      <section className="space-y-3">
        <h2 className="font-semibold">ระบบหมุนคิว</h2>
        <ClubQueuePanel
          clubId={club.id}
          matches={clubMatches}
          players={players.map((p) => ({ id: p.id, display_name: p.display_name }))}
          settings={queueSettings}
          canManage={canManage}
        />
      </section>

      {(club.court_fee > 0 || club.shuttle_fee > 0) && (
        <section className="space-y-2">
          <h2 className="font-semibold">สรุปค่าใช้จ่าย</h2>
          <Card>
            <CardContent className="pt-4">
              <ClubCostBreakdown club={club} players={players} />
            </CardContent>
          </Card>
        </section>
      )}
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
