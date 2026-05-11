import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Anuphan, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const anuphan = Anuphan({
  variable: "--font-sans",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ก๊วนแบด",
  description: "หาก๊วนตีแบดง่ายๆ",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const store = await cookies();
  const theme = store.get("theme")?.value ?? "system";
  const isDark = theme === "dark";
  const htmlClass = `${anuphan.variable} ${geistMono.variable} h-full antialiased${isDark ? " dark" : ""}`;

  return (
    <html
      lang="th"
      className={htmlClass}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl px-4 py-6 flex-1">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
