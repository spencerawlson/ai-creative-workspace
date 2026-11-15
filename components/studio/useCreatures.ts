"use client";

import { useEffect, useState } from "react";
import {
  creatureFileUrl,
  loadCreatures,
  type CreatureEntry,
} from "@/lib/studio/creatures";

export interface CreatureLibrary {
  /** The app's built-in creatures (lib/studio/creatures.ts). Empty
   * until loaded, or when there are none. */
  list: CreatureEntry[];
  /** A file URL per creature, for the 3D view. */
  urls: Record<string, string>;
  /** How tall each creature stands, in metres, by creature id. */
  heights: Record<string, number>;
}

/** The device's creature library: served from the app's own address. */
export function useCreatures(): CreatureLibrary {
  const [list, setList] = useState<CreatureEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadCreatures().then((c) => {
      if (!cancelled) setList(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    list,
    urls: Object.fromEntries(list.map((e) => [e.id, creatureFileUrl(e)])),
    heights: Object.fromEntries(list.map((e) => [e.id, e.heightMeters])),
  };
}
