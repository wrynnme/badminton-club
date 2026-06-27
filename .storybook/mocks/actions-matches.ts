// Storybook mock for the "use server" module `@/lib/actions/matches`.
// The real module starts with "use server" and pulls in the supabase
// service-role client + next/headers + getSession — none of which can load in
// the browser runtime Storybook / vitest-browser use. Stories render rows with
// isOwner=false, so the reset / enter-score buttons (the only callers of these
// actions) never mount and nothing is actually invoked. These no-op stubs exist
// only to satisfy the import graph. Aliased in `.storybook/main.ts` viteFinal.

export async function resetMatchScoreAction(): Promise<{ error?: string }> {
  return {};
}

export async function recordMatchScoreAction(): Promise<{ error?: string }> {
  return {};
}
