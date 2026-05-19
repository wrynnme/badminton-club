// TanStack Form `field.state.meta.errors` is an unknown[]. When zod is the
// validator, each entry is a ZodIssue object; calling String(issue) yields
// "[object Object]". This helper normalizes to { message } so shadcn's
// <FieldError> renders the actual Thai message from the zod schema.
export function fieldErrors(errors: unknown[]) {
  return errors.map((e) => ({
    message:
      typeof e === "string"
        ? e
        : (e as { message?: string } | null)?.message ?? "ไม่ถูกต้อง",
  }));
}
