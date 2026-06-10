import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditProfileForm } from "@/components/profile/edit-profile-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/?auth_error=login_required&redirectTo=/settings");

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">ตั้งค่าบัญชี</h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">โปรไฟล์</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14">
              {session.pictureUrl && <AvatarImage src={session.pictureUrl} />}
              <AvatarFallback className="text-lg">{session.displayName.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <p className="font-medium">{session.displayName}</p>
              <Badge variant={session.isGuest ? "secondary" : "outline"}>
                {session.isGuest ? "guest" : "LINE"}
              </Badge>
            </div>
          </div>
          <EditProfileForm displayName={session.displayName} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">บัญชี</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <form action="/api/auth/logout" method="post">
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" type="submit">ออกจากระบบ</Button>} />
              <TooltipContent>ออกจากระบบเฉพาะอุปกรณ์นี้</TooltipContent>
            </Tooltip>
          </form>
          <form action="/api/auth/logout-all" method="post">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outline" type="submit" className="text-destructive hover:text-destructive">
                    ออกจากทุกอุปกรณ์
                  </Button>
                }
              />
              <TooltipContent>เพิกถอน session ทั้งหมดทุกอุปกรณ์ — ต้องเข้าสู่ระบบใหม่</TooltipContent>
            </Tooltip>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
