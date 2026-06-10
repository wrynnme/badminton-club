import { z } from "zod";

/**
 * Single source of truth for the display-name constraint — imported by BOTH the
 * client form (edit-profile-form.tsx) and the server action (actions/profile.ts)
 * so the rule + messages can't drift. Lives outside the "use server" action file
 * because that file may only export async server actions, not a schema value.
 */
export const DisplayNameSchema = z.object({
  display_name: z.string().trim().min(1, "ระบุชื่อ").max(40, "ชื่อยาวเกินไป (สูงสุด 40 ตัวอักษร)"),
});

export type UpdateProfileInput = z.infer<typeof DisplayNameSchema>;
