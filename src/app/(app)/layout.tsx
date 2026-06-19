import { SiteHeader } from "@/components/site-header";
import { LiffAutoLogin } from "@/components/auth/liff-auto-login";
import { getSession } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // Auto-login inside the LINE in-app browser only matters when the visitor is
  // logged out, or is a guest we can upgrade to their real LINE account.
  const shouldAttempt = !session || session.isGuest;

  return (
    <>
      <LiffAutoLogin liffId={process.env.NEXT_PUBLIC_LIFF_ID} shouldAttempt={shouldAttempt} />
      <SiteHeader />
      <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-6 flex-1">
        {children}
      </main>
    </>
  );
}
