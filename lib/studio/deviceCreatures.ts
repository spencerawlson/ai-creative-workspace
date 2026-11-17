/** Creatures made on this device: an imported model with no skeleton
 * that auto-rigging recognised as an animal (app/api/rig). Kept in the
 * browser like imported characters (lib/studio/characters.ts), with
 * ids that fit the creature format (creature-u-…), so a figure, its
 * walk and share links treat them as creatures; another device, which
 * doesn't have the file, shows the mannequin instead, as it does for an
 * imported character. */

import type { CreatureEntry } from "./creatures";

export const MAX_DEVICE_CREATURES = 12;
/** How tall a new device creature stands until changed, in metres. */
export const DEVICE_CREATURE_HEIGHT = 1;

export interface DeviceCreature {
  id: string;
  name: string;
  heightMeters: number;
  /** "quadruped" or "biped", as the rigger found it. */
  kind: string;
  addedAt: number;
}

interface Stored extends DeviceCreature {
  blob: Blob;
}

/** A fresh id in the creature format. */
export function newDeviceCreatureId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `creature-u-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** As a creature entry (for lists): built in, it would name its file
 * and credit; on the device, it says how it was made. */
export function asCreatureEntry(c: DeviceCreature, size = 0): CreatureEntry {
  return {
    id: c.id,
    name: c.name,
    file: "device.glb",
    size: Math.max(1, size),
    heightMeters: c.heightMeters,
    credit: {
      tool: "Auto-rig",
      prompt: `recognised as a ${c.kind === "quadruped" ? "four-legged" : "two-legged"} animal and rigged on this device`,
    },
  };
}

const DB_NAME = "iko3d-creatures";
const STORE = "creatures";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadDeviceCreatures(): Promise<
  Array<DeviceCreature & { blob: Blob }>
> {
  try {
    const all = await run(
      "readonly",
      (s) => s.getAll() as IDBRequest<Stored[]>,
    );
    return all.sort((a, b) => a.addedAt - b.addedAt);
  } catch {
    return [];
  }
}

/** Keep a rigged animal; returns its entry, or why not. */
export async function addDeviceCreature(
  blob: Blob,
  name: string,
  kind: string,
  count: number,
): Promise<{ creature: DeviceCreature } | { error: string }> {
  if (count >= MAX_DEVICE_CREATURES)
    return {
      error: `At most ${MAX_DEVICE_CREATURES} animals of your own on this device; remove one first.`,
    };
  const creature: DeviceCreature = {
    id: newDeviceCreatureId(),
    name: name.slice(0, 40) || "Animal",
    heightMeters: DEVICE_CREATURE_HEIGHT,
    kind,
    addedAt: Date.now(),
  };
  try {
    await run("readwrite", (s) =>
      s.put({ ...creature, blob } satisfies Stored),
    );
  } catch {
    return {
      error:
        "This browser couldn't keep the file (storage full or private mode).",
    };
  }
  return { creature };
}

export async function removeDeviceCreature(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}
