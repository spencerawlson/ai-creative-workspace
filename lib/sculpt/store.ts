/** Sculptures kept on this device (IndexedDB), never uploaded. The list
 * (names, dates, sizes) is a store of its own, so showing it doesn't
 * read every mesh. */

export interface SculptEntry {
  id: string;
  name: string;
  updatedAt: number;
  triangles: number;
}

export interface SculptData {
  id: string;
  positions: Float32Array;
  index: Uint32Array;
}

/** Kept at once; saving past this lets the oldest go. */
export const MAX_SCULPTS = 30;

/** Ids sort by age: creation time, then a random tail. */
export function newSculptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const time = Date.now().toString(36).padStart(9, "0");
  return `sc-${time}${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

const DB_NAME = "iko3d-sculpts";
const META = "meta";
const DATA = "data";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: "id" });
      req.result.createObjectStore(DATA, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** Every kept sculpture, newest change first; [] where storage fails. */
export async function listSculpts(): Promise<SculptEntry[]> {
  try {
    const all =
      (await tx<SculptEntry[]>([META], "readonly", (t) =>
        t.objectStore(META).getAll(),
      )) ?? [];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function loadSculpt(id: string): Promise<SculptData | null> {
  try {
    return (
      (await tx<SculptData>([DATA], "readonly", (t) =>
        t.objectStore(DATA).get(id),
      )) ?? null
    );
  } catch {
    return null;
  }
}

/** Save (or overwrite) a sculpture; returns an error message or null. */
export async function saveSculpt(
  entry: SculptEntry,
  data: SculptData,
): Promise<string | null> {
  try {
    const kept = await listSculpts();
    const others = kept.filter((s) => s.id !== entry.id);
    const extra = others.slice(MAX_SCULPTS - 1);
    await tx([META, DATA], "readwrite", (t) => {
      for (const old of extra) {
        t.objectStore(META).delete(old.id);
        t.objectStore(DATA).delete(old.id);
      }
      t.objectStore(META).put(entry);
      t.objectStore(DATA).put(data);
    });
    return null;
  } catch {
    return "This browser couldn't keep the sculpture (storage full or private mode). Export it to keep a copy.";
  }
}

export async function deleteSculpt(id: string): Promise<void> {
  try {
    await tx([META, DATA], "readwrite", (t) => {
      t.objectStore(META).delete(id);
      t.objectStore(DATA).delete(id);
    });
  } catch {
    // Nothing kept, nothing to delete.
  }
}
