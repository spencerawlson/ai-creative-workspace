/** Imported characters, kept on this device (IndexedDB) and never
 * uploaded. A scene refers to one by id (`figure.character`); where the
 * file isn't on the device, the figure's mannequin stands in. */

/** Big enough for detailed VRM/GLB characters; phones still cope. */
export const MAX_CHARACTER_BYTES = 100 * 1024 * 1024;
/** Kept on the device at once. */
export const MAX_CHARACTERS = 12;

export interface CharacterEntry {
  id: string;
  name: string;
  size: number;
  addedAt: number;
}

/** Why a file can't be a character, from its name, size and first
 * bytes; null when it looks fine. GLB and VRM (a GLB) only: a .gltf
 * points at other files the browser can't reach. */
export function checkCharacterFile(
  name: string,
  size: number,
  head: Uint8Array,
): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "gltf")
    return "A .gltf file points at other files; export a single .glb (or .vrm) instead.";
  if (ext === "fbx" || ext === "obj" || ext === "blend")
    return `.${ext} files can't be read here; export the character as .glb or .vrm.`;
  if (ext !== "glb" && ext !== "vrm") return "Choose a .glb or .vrm file.";
  if (size > MAX_CHARACTER_BYTES)
    return `That file is ${Math.round(size / 1024 / 1024)} MB; the limit is ${MAX_CHARACTER_BYTES / 1024 / 1024} MB.`;
  const magic = String.fromCharCode(...head.slice(0, 4));
  if (magic !== "glTF") return "That file isn't a GLB (binary glTF) file.";
  return null;
}

/** The name shown for a file: without its extension, tidied. */
export function characterName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return (base || "Character").slice(0, 40);
}

export function newCharacterId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `ch-${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

// ------------------------------------------------------------ storage

const DB_NAME = "iko3d-characters";
const STORE = "characters";

interface Stored extends CharacterEntry {
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

/** Every character on this device, oldest first, with its file. */
export async function loadCharacters(): Promise<
  Array<CharacterEntry & { blob: Blob }>
> {
  const all = await run("readonly", (s) => s.getAll() as IDBRequest<Stored[]>);
  return all.sort((a, b) => a.addedAt - b.addedAt);
}

/** Check and keep a file; returns the new entry, or why not. */
export async function addCharacterFile(
  file: File,
  count: number,
): Promise<{ entry: CharacterEntry; blob: Blob } | { error: string }> {
  if (count >= MAX_CHARACTERS)
    return {
      error: `At most ${MAX_CHARACTERS} characters on this device; remove one first.`,
    };
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const problem = checkCharacterFile(file.name, file.size, head);
  if (problem) return { error: problem };
  const entry: CharacterEntry = {
    id: newCharacterId(),
    name: characterName(file.name),
    size: file.size,
    addedAt: Date.now(),
  };
  const blob = new Blob([file], { type: "model/gltf-binary" });
  try {
    await run("readwrite", (s) => s.put({ ...entry, blob } satisfies Stored));
  } catch {
    return {
      error:
        "This browser couldn't keep the file (storage full or private mode).",
    };
  }
  return { entry, blob };
}

export async function removeCharacter(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}
