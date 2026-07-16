/**
 * PostgREST `.or()` filter string selecting rows the user owns OR co-admins:
 * `owner_id = profileId` OR `id ∈ adminIds`. Empty adminIds → owner-only.
 *
 * Safe to string-interpolate: `profileId` comes from the signed `bc_session`
 * cookie (= `profiles.id`, uuid) and `adminIds` come from the uuid `id` column
 * of `clubs` / `tournaments`, so neither can carry PostgREST metacharacters.
 *
 * Used by `/clubs`, `/tournaments/mine`, and `fetchMySessionRows`
 * (my-sessions.server.ts) — owner-or-co-admin lists.
 */
export function ownerOrAdminOrFilter(profileId: string, adminIds: string[]): string {
  const parts = [`owner_id.eq.${profileId}`];
  if (adminIds.length) parts.push(`id.in.(${adminIds.join(",")})`);
  return parts.join(",");
}
