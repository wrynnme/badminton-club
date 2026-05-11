import { notFound } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays, Clock, MapPin, Users, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { JoinForm } from "@/components/club/join-form";
import { LeaveButton } from "@/components/club/leave-button";
import { SetTotalCostForm } from "@/components/club/set-total-cost-form";

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

  const { data: owner } = await sb
    .from("profiles")
    .select("display_name, picture_url")
    .eq("id", club.owner_id)
    .single();

  const { data: players } = await sb
    .from("club_players")
    .select("*")
    .eq("club_id", id)
    .order("joined_at", { ascending: true });

  const joined = players?.length ?? 0;
  const full = joined >= club.max_players;
  const myRow = session
    ? players?.find((p) => p.profile_id === session.profileId)
    : null;

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
            text={`${club.start_time.slice(0,5)} – ${club.end_time.slice(0,5)}`}
          />
          <Info
            label={<Users className="h-4 w-4" />}
            text={`${joined} / ${club.max_players} คน`}
          />
          {club.total_cost ? (
            <Info
              label={<Wallet className="h-4 w-4" />}
              text={joined > 0
                ? `${(club.total_cost / joined).toFixed(0)} บาท/คน (รวม ${club.total_cost} บาท)`
                : `รวม ${club.total_cost} บาท`}
            />
          ) : null}
          {club.shuttle_info && <Info label="🏸" text={club.shuttle_info} />}
        </CardContent>
      </Card>

      {club.notes && (
        <Card>
          <CardHeader><CardTitle className="text-base">หมายเหตุ</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{club.notes}</CardContent>
        </Card>
      )}

      {session?.profileId === club.owner_id && (
        <SetTotalCostForm clubId={club.id} currentTotal={club.total_cost} />
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
        {!players?.length ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีคนลงชื่อ</p>
        ) : (
          <ol className="space-y-1">
            {players.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2 text-sm border rounded px-3 py-2">
                <span className="text-muted-foreground w-6">{i + 1}.</span>
                <span className="font-medium">{p.display_name}</span>
                {p.level && <Badge variant="outline">{p.level}</Badge>}
                {p.note && <span className="text-muted-foreground text-xs">— {p.note}</span>}
                {session?.profileId === p.profile_id && (
                  <span className="ml-auto"><LeaveButton clubId={club.id} /></span>
                )}
              </li>
            ))}
          </ol>
        )}
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
