import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { Trophy, Plus } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tournament } from "@/lib/types";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "แบบร่าง", variant: "outline" },
  registering: { label: "เปิดรับสมัคร", variant: "secondary" },
  ongoing: { label: "กำลังแข่ง", variant: "default" },
  completed: { label: "จบแล้ว", variant: "destructive" },
};

const formatLabel: Record<string, string> = {
  group_only: "แบ่งกลุ่ม",
  group_knockout: "แบ่งกลุ่ม + Knockout",
  knockout_only: "Knockout",
};

export default async function TournamentsPage() {
  const sb = await createAdminClient();
  const session = await getSession();

  const { data: tournaments } = await sb
    .from("tournaments")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Tournament</h1>
        </div>
        {session && (
          <Link href="/tournaments/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              สร้างทัวร์นาเมนต์
            </Button>
          </Link>
        )}
      </div>

      {!tournaments?.length ? (
        <div className="text-center py-16 text-muted-foreground space-y-3">
          <Trophy className="h-12 w-12 mx-auto opacity-20" />
          <p>ยังไม่มีทัวร์นาเมนต์</p>
          {session && (
            <Link href="/tournaments/new">
              <Button variant="outline">สร้างทัวร์นาเมนต์แรก</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(tournaments as Tournament[]).map((t) => {
            const s = statusLabel[t.status];
            return (
              <Link key={t.id} href={`/tournaments/${t.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">{t.name}</CardTitle>
                      <Badge variant={s.variant} className="shrink-0">{s.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-1">
                    {t.venue && <p>📍 {t.venue}</p>}
                    {t.start_date && (
                      <p>📅 {format(new Date(t.start_date), "d MMM yyyy", { locale: th })}</p>
                    )}
                    <p>🏆 {formatLabel[t.format]} · {t.team_count} ทีม</p>
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
