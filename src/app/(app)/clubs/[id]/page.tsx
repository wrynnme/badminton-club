import { notFound } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays, Clock, MapPin, Users, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { JoinForm } from "@/components/club/join-form";
import { EditClubForm } from "@/components/club/edit-club-form";
import { SortablePlayerList } from "@/components/club/sortable-player-list";
import { ExpenseManager } from "@/components/club/expense-manager";
import { ClubCoAdminControls } from "@/components/club/club-co-admin-controls";
import type { ClubExpense, ClubAdmin } from "@/lib/actions/clubs";

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

  const [ownerRes, playersRes, expensesRes, adminsRes] = await Promise.all([
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
      .select("club_id, user_id, added_by, added_at, profile:profiles!user_id(display_name, line_user_id)")
      .eq("club_id", id)
      .order("added_at", { ascending: true }),
  ]);

  const owner = ownerRes.data;
  const players = playersRes.data ?? [];
  const expenses: ClubExpense[] = (expensesRes.data ?? []) as ClubExpense[];

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

  // Compute total from expenses; fall back to legacy total_cost
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const displayTotal = expenseTotal > 0 ? expenseTotal : (club.total_cost ?? 0);
  const perPerson = joined > 0 && displayTotal > 0 ? Math.ceil(displayTotal / joined) : null;

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
        <CardContent className="grid sm:grid-cols-2 gap-3 pt-6 text-sm">
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
          {perPerson && (
            <Info
              label={<Wallet className="h-4 w-4" />}
              text={`~${perPerson.toLocaleString()} บาท/คน (รวม ${displayTotal.toLocaleString()} บาท)`}
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
              />
            </CardContent>
          </Card>

          <ClubCoAdminControls clubId={club.id} initialAdmins={coAdmins} />
        </div>
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
        <SortablePlayerList
          clubId={club.id}
          players={players}
          sessionProfileId={session?.profileId ?? null}
          canManage={canManage}
        />
      </section>
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
