"use client";

import { ProgressProvider as BProgressProvider } from "@bprogress/next/app";

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  return (
    <BProgressProvider
      height="3px"
      color="var(--primary)"
      options={{ showSpinner: false }}
      shallowRouting
    >
      {children}
    </BProgressProvider>
  );
}
