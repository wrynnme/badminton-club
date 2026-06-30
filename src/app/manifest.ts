import type { MetadataRoute } from "next";
import { BRAND_THEME_COLOR } from "@/lib/brand";

// PWA manifest (Next 16 metadata route). Icons use the Kuanbad favicon mark;
// theme_color is the navy primary (matches viewport.themeColor in layout).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ก๊วนแบด",
    short_name: "ก๊วนแบด",
    description: "หาก๊วนตีแบดง่ายๆ",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: BRAND_THEME_COLOR,
    icons: [
      { src: "/logo/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/logo/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/logo/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
