// TanStack Form `field.state.meta.errors` is an unknown[]. When zod is the
// validator, each entry is a ZodIssue object; calling String(issue) yields
// "[object Object]". This helper normalizes to { message } so shadcn's
// <FieldError> renders the actual Thai message from the zod schema.
export function fieldErrors(errors: unknown[]) {
  return errors.map((e) => ({
    message:
      typeof e === "string"
        ? e
        : // NOTE: This literal fallback ("ไม่ถูกต้อง") is intentionally kept here.
          // This is a non-React module — it cannot call useTranslations(). The fallback
          // is unreachable in practice because every validator in this codebase provides
          // an explicit message string (translated at the call site via t("validation.key")).
          (e as { message?: string } | null)?.message ?? "ไม่ถูกต้อง",
  }));
}
