import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getSession } from "@/lib/auth/session";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/clubs");

  const sp = await searchParams;
  const errorMap: Record<string, string> = {
    state: "OAuth state ไม่ตรง ลองใหม่",
    token: "แลก token ไม่สำเร็จ",
    profile: "ดึง profile LINE ไม่ได้",
    db: "บันทึก profile ไม่ได้",
    name: "ระบุชื่ออย่างน้อย 2 ตัวอักษร",
    login_required: "ต้องเข้าสู่ระบบก่อน",
  };

  return (
    <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto pt-10">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">🏸 ก๊วนแบด</h1>
        <p className="text-muted-foreground">
          สร้างก๊วน. ชวนเพื่อน. ลงชื่อเล่น. จบ.
        </p>
        <ul className="text-sm space-y-1 text-muted-foreground list-disc pl-5">
          <li>สร้างก๊วนของตัวเอง</li>
          <li>ดูก๊วนคนอื่น แล้วลงชื่อเล่นได้</li>
          <li>เข้าสู่ระบบด้วย LINE หรือเล่นเป็น guest</li>
        </ul>
        <Link href="/clubs">
          <Button variant="outline">ดูก๊วนทั้งหมด</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>เข้าสู่ระบบ</CardTitle>
          <CardDescription>เลือกวิธีที่สะดวก</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sp.auth_error && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {errorMap[sp.auth_error] ?? sp.auth_error}
            </div>
          )}

          <a href="/api/auth/line">
            <Button className="w-full bg-[#06C755] hover:bg-[#05a648] text-white">
              เข้าสู่ระบบด้วย LINE
            </Button>
          </a>

          <div className="flex items-center gap-2">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">หรือ</span>
            <Separator className="flex-1" />
          </div>

          <form action="/api/auth/guest" method="post" className="space-y-2">
            <Label htmlFor="name">เล่นเป็น guest</Label>
            <Input id="name" name="name" placeholder="ชื่อที่ใช้แสดง" required minLength={2} />
            <Button type="submit" variant="secondary" className="w-full">
              เริ่มแบบ guest
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
