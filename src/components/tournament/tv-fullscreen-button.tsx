"use client";

import { useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";

export function TvFullscreenButton() {
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isFs ? "ออกจาก fullscreen" : "เข้า fullscreen"}
      className="inline-flex items-center justify-center rounded-md border h-9 w-9 lg:h-10 lg:w-10 hover:bg-accent transition-colors cursor-pointer"
    >
      {isFs ? <Minimize className="h-4 w-4 lg:h-5 lg:w-5" /> : <Maximize className="h-4 w-4 lg:h-5 lg:w-5" />}
    </button>
  );
}
