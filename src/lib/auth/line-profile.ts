import { createAdminClient } from "@/lib/supabase/server";

export type LineProfileInput = {
  /** LINE userId — the OAuth `/v2/profile.userId` or the ID-token `sub`. */
  userId: string;
  displayName: string;
  pictureUrl?: string | null;
};

export type StoredProfile = {
  id: string;
  display_name: string;
  picture_url: string | null;
};

/**
 * Upsert a LINE-authenticated profile, then return the stored row (or null on a
 * DB error / unrecoverable race). Shared by the OAuth callback
 * (`/api/auth/line/callback`) and the LIFF auto-login endpoint (`/api/auth/liff`)
 * so both mint sessions from the exact same profile rules.
 *
 * First login seeds `display_name` from LINE; return logins only refresh the
 * picture and DO NOT touch `display_name`, so a name the user edited in
 * /settings survives. Trade-off: LINE-side renames are no longer mirrored.
 * (A plain upsert can't express this — onConflict overwrites every column,
 * `display_name` included.)
 */
export async function upsertLineProfile(
  input: LineProfileInput
): Promise<StoredProfile | null> {
  const sb = await createAdminClient();

  const { data: updated, error: updateError } = await sb
    .from("profiles")
    .update({ picture_url: input.pictureUrl ?? null, is_guest: false })
    .eq("line_user_id", input.userId)
    .select()
    .maybeSingle();

  if (updateError) return null;

  let profile = updated;
  if (!profile) {
    // First login for this LINE account.
    const { data: inserted, error: insertError } = await sb
      .from("profiles")
      .insert({
        line_user_id: input.userId,
        display_name: input.displayName,
        picture_url: input.pictureUrl ?? null,
        is_guest: false,
      })
      .select()
      .single();

    if (insertError?.code === "23505") {
      // Concurrent first-login race: a parallel request inserted the row between
      // our update and insert. Re-read it instead of failing the login.
      const { data: raced } = await sb
        .from("profiles")
        .select()
        .eq("line_user_id", input.userId)
        .single();
      profile = raced ?? null;
    } else if (!insertError) {
      profile = inserted;
    }
  }

  return (profile as StoredProfile | null) ?? null;
}
