"use client";

import { useCallback, useEffect, useState } from "react";
import type { RenderQuality } from "@/lib/engine/StudioEngine";

const KEY = "iko3d-render-quality";

/** This device's render quality: what the user picked here, else High
 * on a computer (fine pointer, wide screen) and Fast on phones and
 * tablets, which keeps them smooth. Kept in this browser, not in the
 * scene: the same project looks its best on each device. */
export function useRenderQuality(): [
  RenderQuality,
  (q: RenderQuality) => void,
] {
  const [quality, setQuality] = useState<RenderQuality>("fast");
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(KEY);
    } catch {
      // Private mode: the default for this device.
    }
    setQuality(
      stored === "fast" || stored === "high"
        ? stored
        : window.matchMedia("(pointer: fine) and (min-width: 1024px)").matches
          ? "high"
          : "fast",
    );
  }, []);
  const choose = useCallback((q: RenderQuality) => {
    setQuality(q);
    try {
      window.localStorage.setItem(KEY, q);
    } catch {
      // Not kept; still applies until the page closes.
    }
  }, []);
  return [quality, choose];
}
