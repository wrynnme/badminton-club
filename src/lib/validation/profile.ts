import { z } from "zod";

/**
 * Factory — call inside a client component where useTranslations("validation")
 * is in scope. Passes translated messages so FieldError renders them.
 *
 * Server consumer (actions/profile.ts) imports the pre-built DisplayNameSchema
 * below which uses English fallback messages — server validation errors surface
 * as toast.error strings, not FieldError UI, so locale doesn't matter there.
 */
export function makeDisplayNameSchema(msgs: {
  required: string;
  tooLong: string;
}) {
  return z.object({
    display_name: z
      .string()
      .trim()
      .min(1, msgs.required)
      .max(40, msgs.tooLong),
  });
}

/**
 * Pre-built schema with English fallback messages — imported by
 * actions/profile.ts (a 'use server' file that cannot call useTranslations).
 * Keep this export so the server action does not need to change.
 */
export const DisplayNameSchema = makeDisplayNameSchema({
  required: "Name is required",
  tooLong: "Name is too long (max 40 characters)",
});

export type UpdateProfileInput = z.infer<typeof DisplayNameSchema>;
