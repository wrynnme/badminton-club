import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Anuphan, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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
}: Readonly<{ children: React.ReactNode }>) {
  const store = await cookies();
  const theme = store.get("theme")?.value ?? "system";
  const isDark = theme === "dark";

  return (
    <html
      lang="th"
      className={`${anuphan.variable} ${geistMono.variable} h-full antialiased${isDark ? " dark" : ""}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background">
        <TooltipProvider delay={300}>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
