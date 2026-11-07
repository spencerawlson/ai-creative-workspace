/** Sounds for lip sync, kept on this device (IndexedDB) and never
 * uploaded. A lip-sync track refers to one by id (`speech.sound`) to
 * play it with the animation and put it in videos; where the sound
 * isn't on the device the mouth still moves, silently. */

export const MAX_SOUND_BYTES = 50 * 1024 * 1024;
/** Kept on the device at once; the oldest goes first. */
export const MAX_SOUNDS = 24;

export interface SoundEntry {
  id: string;
  name: string;
  addedAt: number;
}

/** Ids sort by age: the time they were added, then a random tail. */
export function newSoundId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const time = Date.now().toString(36).padStart(9, "0");
  return `snd-${time}${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

/** The name shown for a sound file: without its extension, tidied. */
export function soundName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return (base || "Sound").slice(0, 64);
}

// ------------------------------------------------------------ storage

const DB_NAME = "iko3d-sounds";
const STORE = "sounds";

interface Stored extends SoundEntry {
  blob: Blob;
}

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

/** A kept sound's file, or null if it isn't on this device. */
export async function loadSound(id: string): Promise<Blob | null> {
  try {
    const s = await run("readonly", (st) => st.get(id) as IDBRequest<Stored>);
    return s?.blob ?? null;
  } catch {
    return null;
  }
}

/** Keep a sound file; returns its entry, or why not. Past MAX_SOUNDS
 * the oldest is let go (its tracks go silent, their mouths still move). */
export async function addSoundFile(
  file: File,
): Promise<SoundEntry | { error: string }> {
  if (file.size > MAX_SOUND_BYTES)
    return {
      error: `That file is ${Math.round(file.size / 1024 / 1024)} MB; the limit is ${MAX_SOUND_BYTES / 1024 / 1024} MB.`,
    };
  const entry: SoundEntry = {
    id: newSoundId(),
    name: soundName(file.name),
    addedAt: Date.now(),
  };
  try {
    const ids = (await run("readonly", (s) => s.getAllKeys())) as string[];
    const old = ids.sort().slice(0, Math.max(0, ids.length - MAX_SOUNDS + 1));
    for (const id of old) await run("readwrite", (s) => s.delete(id));
    const blob = new Blob([file], { type: file.type || "audio/*" });
    await run("readwrite", (s) => s.put({ ...entry, blob } satisfies Stored));
  } catch {
    return {
      error:
        "This browser couldn't keep the sound (storage full or private mode).",
    };
  }
  return entry;
}
