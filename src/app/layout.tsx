import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Anuphan, Chakra_Petch, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ProgressProvider } from "@/components/providers/progress-provider";
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

// Display font for headings / scoreboard numerals via the `font-heading`
// utility (maps to --font-heading in globals.css @theme). Already applied to
// CardTitle + DialogTitle; phase 2 extends it to scoreboard numerals.
const chakraPetch = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
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
      className={`${anuphan.variable} ${geistMono.variable} ${chakraPetch.variable} h-full antialiased${isDark ? " dark" : ""}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background overflow-x-clip">
        <ProgressProvider>
          <TooltipProvider delay={300}>
            <Suspense fallback={<LoadingSpinner fullscreen />}>{children}</Suspense>
          </TooltipProvider>
        </ProgressProvider>
        <Toaster />
      </body>
    </html>
  );
}
