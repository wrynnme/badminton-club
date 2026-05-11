import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { CreateClubForm } from "@/components/club/create-form";

export default async function NewClubPage() {
  const session = await getSession();
  if (!session) redirect("/?auth_error=login_required");

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>สร้างก๊วนใหม่</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateClubForm />
        </CardContent>
      </Card>
    </div>
  );
}
