import { redirect } from "next/navigation";
import { Trophy } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateTournamentForm } from "@/components/tournament/create-tournament-form";

export default async function NewTournamentPage() {
  const session = await getSession();
  if (!session) redirect("/?auth_error=login_required&redirectTo=/tournaments/new");
  if (session.isGuest) redirect("/tournaments?auth_error=line_required");

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">สร้างทัวร์นาเมนต์</h1>

      {/* Mode (กีฬาสี / Competition) is selected inside the form below — Slice 8.
          The old static "Coming Soon" mode-selector cards were removed: they
          contradicted the now-live competition mode and the form's mode radio. */}

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
