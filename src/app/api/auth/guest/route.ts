import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { setSession } from "@/lib/auth/session";

function safeRedirectTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/clubs";
  return value;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const name = (form.get("name") as string | null)?.trim();
  const redirectTo = safeRedirectTo(form.get("redirectTo") as string | null);
  if (!name || name.length < 2) {
    return NextResponse.redirect(new URL("/?auth_error=name", req.url), 303);
  }

  const sb = await createAdminClient();
  const { data: profile, error } = await sb
    .from("profiles")
    .insert({ display_name: name, is_guest: true })
    .select()
    .single();

  if (error || !profile) {
    return NextResponse.redirect(new URL("/?auth_error=db", req.url), 303);
  }

  await setSession({
    profileId: profile.id,
    displayName: profile.display_name,
    isGuest: true,
  });

  return NextResponse.redirect(new URL(redirectTo, req.url), 303);
}
