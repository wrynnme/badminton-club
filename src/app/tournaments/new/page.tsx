import { redirect } from "next/navigation";
import { Trophy, Lock } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateTournamentForm } from "@/components/tournament/create-tournament-form";

export default async function NewTournamentPage() {
  const session = await getSession();
  if (!session) redirect("/?auth_error=login_required&redirectTo=/tournaments/new");

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">สร้างทัวร์นาเมนต์</h1>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-primary ring-1 ring-primary">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">กีฬาสี</CardTitle>
              <Badge>เลือกอยู่</Badge>
            </div>
            <CardDescription>แบ่งทีม แข่งแบบกลุ่มหรือ knockout</CardDescription>
          </CardHeader>
        </Card>
        <Card className="opacity-60 relative overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">แข่งขัน</CardTitle>
              <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />Coming Soon</Badge>
            </div>
            <CardDescription>Ranking, seeding, ระบบแต้ม ELO</CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* Create form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            ข้อมูลทัวร์นาเมนต์
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CreateTournamentForm />
        </CardContent>
      </Card>
    </div>
  );
}
