"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Props = {
  /** From NEXT_PUBLIC_LIFF_ID. Absent → feature disabled (manual login only). */
  liffId?: string;
  /** Server-computed: attempt only when logged out OR currently a guest. */
  shouldAttempt: boolean;
};

const TRIED_KEY = "liff_auto_tried";

/**
 * Silent auto-login when the app is opened inside the LINE in-app browser
 * (LINE Browser). Initializes LIFF, and if LINE already has the user logged in,
 * exchanges the LIFF ID token for a bc_session via POST /api/auth/liff — no
 * button, no OAuth redirect. A guest session is upgraded to the LINE account.
 *
 * Loop-safe: runs at most once per browser tab (sessionStorage flag), and a
 * successful login flips `shouldAttempt` to false on the next render anyway.
 * Outside the LINE client it does nothing — the manual login button stays.
 */
export function LiffAutoLogin({ liffId, shouldAttempt }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!liffId || !shouldAttempt) return;
    if (typeof window === "undefined") return;
    // Guard one in-flight attempt per tab: set synchronously so React Strict
    // Mode's double effect-invoke (and rapid re-renders) can't fire two
    // concurrent logins. A *transient* failure clears it again below so a later
    // navigation can retry — only definitive outcomes keep it set.
    if (sessionStorage.getItem(TRIED_KEY) === "1") return;
    sessionStorage.setItem(TRIED_KEY, "1");

    void (async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });
        // Outside the LINE in-app browser (or LINE not logged in) there is
        // nothing to do and nothing to retry — keep the flag so we don't re-init
        // LIFF on every navigation in a normal browser.
        if (!liff.isInClient() || !liff.isLoggedIn()) return;
        const idToken = liff.getIDToken();
        if (!idToken) return;

        const res = await fetch("/api/auth/liff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        if (res.ok) {
          // Re-render server components so the new bc_session takes effect.
          router.refresh();
        } else if (res.status >= 500) {
          // Transient server error → allow a later navigation to retry this tab.
          sessionStorage.removeItem(TRIED_KEY);
        }
        // A 4xx (bad/expired token) is deterministic — keep the flag set and
        // fall back to the manual login button rather than retry-storm.
      } catch {
        // LIFF init / network flake — transient, so allow a later retry. The
        // manual login button remains the fallback regardless.
        sessionStorage.removeItem(TRIED_KEY);
      }
    })();
  }, [liffId, shouldAttempt, router]);

  return null;
}
