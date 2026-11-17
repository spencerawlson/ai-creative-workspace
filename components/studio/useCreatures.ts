"use client";

import { useCallback, useEffect, useState } from "react";
import {
  creatureFileUrl,
  loadCreatures,
  type CreatureEntry,
} from "@/lib/studio/creatures";
import {
  addDeviceCreature,
  asCreatureEntry,
  loadDeviceCreatures,
  removeDeviceCreature,
} from "@/lib/studio/deviceCreatures";

export interface CreatureLibrary {
  /** The app's built-in creatures (lib/studio/creatures.ts), then the
   * animals rigged on this device. Empty until loaded. */
  list: CreatureEntry[];
  /** A file URL per creature, for the 3D view. */
  urls: Record<string, string>;
  /** How tall each creature stands, in metres, by creature id. */
  heights: Record<string, number>;
  /** Ids of the creatures kept on this device (not built in). */
  onDevice: ReadonlySet<string>;
  /** Keep a rigged animal on this device; its id, or why not. */
  add?: (
    blob: Blob,
    name: string,
    kind: string,
  ) => Promise<{ id: string } | { error: string }>;
  remove?: (id: string) => Promise<void>;
}

/** The device's creature library: the app's own, and this device's. */
export function useCreatures(): CreatureLibrary {
  const [list, setList] = useState<CreatureEntry[]>([]);
  const [mine, setMine] = useState<
    Array<{ entry: CreatureEntry; url: string }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    void loadCreatures().then((c) => {
      if (!cancelled) setList(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    const stored = await loadDeviceCreatures();
    setMine((old) => {
      for (const o of old) URL.revokeObjectURL(o.url);
      return stored.map((c) => ({
        entry: asCreatureEntry(c, c.blob.size),
        url: URL.createObjectURL(c.blob),
      }));
    });
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(
    async (blob: Blob, name: string, kind: string) => {
      const r = await addDeviceCreature(blob, name, kind, mine.length);
      if ("error" in r) return r;
      await reload();
      return { id: r.creature.id };
    },
    [mine.length, reload],
  );
  const remove = useCallback(
    async (id: string) => {
      await removeDeviceCreature(id);
      await reload();
    },
    [reload],
  );

  return {
    list: [...list, ...mine.map((m) => m.entry)],
    urls: {
      ...Object.fromEntries(list.map((e) => [e.id, creatureFileUrl(e)])),
      ...Object.fromEntries(mine.map((m) => [m.entry.id, m.url])),
    },
    heights: Object.fromEntries(
      [...list, ...mine.map((m) => m.entry)].map((e) => [e.id, e.heightMeters]),
    ),
    onDevice: new Set(mine.map((m) => m.entry.id)),
    add,
    remove,
  };
}
