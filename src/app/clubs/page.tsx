import Link from "next/link";
import { format } from "date-fns";
import { createAdminClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, MapPin, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ClubsPage() {
  const sb = await createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: clubs } = await sb
    .from("clubs")
    .select("id, name, venue, play_date, start_time, end_time, max_players")
    .gte("play_date", today)
    .order("play_date", { ascending: true });

  const { data: counts } = await sb
    .from("club_players")
    .select("club_id");

  const countMap = new Map<string, number>();
  for (const r of counts ?? []) {
    countMap.set(r.club_id, (countMap.get(r.club_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ก๊วนทั้งหมด</h1>
        <Link href="/clubs/new">
          <Button>+ สร้างก๊วน</Button>
        </Link>
      </div>

      {!clubs?.length ? (
        <p className="text-muted-foreground">ยังไม่มีก๊วน. ลองสร้างก๊วนแรกเลย.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clubs.map((c) => {
            const joined = countMap.get(c.id) ?? 0;
            const full = joined >= c.max_players;
            return (
              <Link key={c.id} href={`/clubs/${c.id}`}>
                <Card className="hover:shadow-md transition">
                  <CardHeader>
                    <CardTitle className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1">{c.name}</span>
                      {full ? (
                        <Badge variant="destructive">เต็ม</Badge>
                      ) : (
                        <Badge variant="secondary">{joined}/{c.max_players}</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      <span className="line-clamp-1">{c.venue}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4" />
                      <span>
                        {format(new Date(c.play_date), "d MMM")} {c.start_time.slice(0,5)}–{c.end_time.slice(0,5)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      <span>{joined}/{c.max_players} คน</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
