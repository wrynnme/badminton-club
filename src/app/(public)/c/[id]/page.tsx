import { notFound } from "next/navigation";
import { Suspense } from "react";
import { format } from "date-fns";
import { CalendarDays, Clock, MapPin, Users, Globe } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClubTabs } from "@/components/club/club-tabs";
import { ClubDashboard } from "@/components/club/club-dashboard";
import { SortablePlayerList } from "@/components/club/sortable-player-list";
import { HourlyHeadcount } from "@/components/club/hourly-headcount";
import { ClubQueuePanel } from "@/components/club/club-queue-panel";
import { ClubLockedPairs } from "@/components/club/club-locked-pairs";
import { parseQueueSettings } from "@/lib/club/queue-settings";
import { resolveClubCourts } from "@/lib/club/courts";
import { toPublicClub, toPublicPlayer } from "@/lib/club/public-view";
import { ClubInfoRow } from "@/components/club/club-info-row";
import type { Club, ClubMatch, ClubLockedPair, Level } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PublicClubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createAdminClient();

  const { data: clubRow } = await sb.from("clubs").select("*").eq("id", id).single();
  // Gate: only public clubs are viewable here. Private (default) → 404.
  if (!clubRow || !clubRow.is_public) notFound();
  const club = clubRow as Club;

  const [ownerRes, playersRes, matchesRes, lockedPairsRes, levelsRes] = await Promise.all([
    sb.from("profiles").select("display_name").eq("id", club.owner_id).single(),
    sb
      .from("club_players")
      .select("*")
      .eq("club_id", id)
      .order("position", { ascending: true, nullsFirst: false })
      .order("joined_at", { ascending: true }),
    sb
      .from("club_matches")
      .select("*")
      .eq("club_id", id)
      .order("queue_position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    sb.from("club_locked_pairs").select("*").eq("club_id", id).order("created_at", { ascending: true }),
    sb.from("levels").select("*").order("sort_order", { ascending: true }).order("real", { ascending: true }),
  ]);

  const owner = ownerRes.data;
  const players = playersRes.data ?? [];
  const clubMatches: ClubMatch[] = (matchesRes.data ?? []) as ClubMatch[];
  const lockedPairs: ClubLockedPair[] = (lockedPairsRes.data ?? []) as ClubLockedPair[];
  const levels: Level[] = (levelsRes.data ?? []) as Level[];

  const activeCount = players.filter((p) => p.status === "active").length;
  const reserveCount = players.filter((p) => p.status === "reserve").length;

  const queueSettings = parseQueueSettings(club.queue_settings);
  const clubCourts = resolveClubCourts(club.courts, queueSettings.court_count);

  // Public viewers don't see money / PII. Sanitize at the source via the shared
  // allowlist (toPublicClub / toPublicPlayer) so sensitive fields never ship in the
  // RSC props and a new Club/ClubPlayer column becomes a compile error there. See
  // src/lib/club/public-view.ts.
  const publicClub = toPublicClub(club);
  const publicPlayers = players.map(toPublicPlayer);
  // The queue + locked-pairs panels only need id + name; derive once from the
  // already-sanitized list instead of re-walking the raw players twice.
  const nameList = publicPlayers.map((p) => ({ id: p.id, display_name: p.display_name }));

  return (
    <div className="space-y-6 max-w-3xl mx-auto px-3 sm:px-4 py-6">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-2xl font-bold">{club.name}</h1>
          <Badge variant="outline" className="shrink-0 text-muted-foreground gap-1">
            <Globe className="h-3 w-3" /> สาธารณะ
          </Badge>
        </div>
        {owner && <p className="text-sm text-muted-foreground mt-1">โดย {owner.display_name}</p>}
      </div>

      <Card>
        <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
          <ClubInfoRow label={<MapPin className="h-4 w-4" />} text={club.venue} />
          <ClubInfoRow label={<CalendarDays className="h-4 w-4" />} text={format(new Date(club.play_date), "EEE d MMM yyyy")} />
          <ClubInfoRow label={<Clock className="h-4 w-4" />} text={`${club.start_time.slice(0, 5)} – ${club.end_time.slice(0, 5)}`} />
          <ClubInfoRow
            label={<Users className="h-4 w-4" />}
            text={`${activeCount}${reserveCount > 0 ? ` (+${reserveCount} สำรอง)` : ""} / ${club.max_players} คน`}
          />
          {/* shuttle_info intentionally omitted on public — it commonly carries pricing */}
        </CardContent>
      </Card>

      <Suspense fallback={null}>
        <ClubTabs
          showSettings={false}
          hideCost
          cost={null}
          settings={null}
          dashboard={
            <ClubDashboard
              club={publicClub}
              players={publicPlayers}
              matches={clubMatches}
              levels={levels}
              expenses={[]}
              costTotal={0}
              maxPlayers={club.max_players}
              hideCost
            />
          }
          checkin={
            <div className="space-y-6">
              <section className="space-y-2">
                <h2 className="font-semibold">รายชื่อผู้เล่น ({players.length})</h2>
                <SortablePlayerList
                  clubId={club.id}
                  players={publicPlayers}
                  sessionProfileId={null}
                  canManage={false}
                  levels={levels}
                  sessionStart={club.start_time}
                  sessionEnd={club.end_time}
                />
              </section>
              {players.length > 0 && (
                <section className="space-y-2">
                  <h2 className="font-semibold">จำนวนคนต่อช่วง</h2>
                  <HourlyHeadcount club={publicClub} players={publicPlayers} />
                </section>
              )}
            </div>
          }
          queue={
            <div className="space-y-4">
              {queueSettings.players_per_team === 2 && (
                <ClubLockedPairs
                  clubId={club.id}
                  players={nameList}
                  locks={lockedPairs}
                  canManage={false}
                />
              )}
              <ClubQueuePanel
                clubId={club.id}
                matches={clubMatches}
                players={nameList}
                settings={queueSettings}
                courts={clubCourts}
                canManage={false}
              />
            </div>
          }
        />
      </Suspense>
    </div>
  );
}
