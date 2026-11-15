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

/** Bytes of a file's start that checkCharacterFile looks at. */
export const CHARACTER_HEAD_BYTES = 16;

/** What a file's first bytes say it is, for the kinds people try. */
function sniff(head: Uint8Array): "glb" | "image" | "zip" | "fbx" | null {
  const text = (from: number, to: number) =>
    String.fromCharCode(...head.slice(from, to));
  if (text(0, 4) === "glTF") return "glb";
  if (
    (head[0] === 0x89 && text(1, 4) === "PNG") ||
    (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) ||
    text(0, 4) === "GIF8" ||
    (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") ||
    // HEIC and AVIF, iPhone and iPad photos: "ftyp" then the brand.
    (text(4, 8) === "ftyp" &&
      /^(heic|heix|hevc|mif1|msf1|avif)$/.test(text(8, 12)))
  )
    return "image";
  if (text(0, 4) === "PK\x03\x04") return "zip";
  if (text(0, 11) === "Kaydara FBX") return "fbx";
  return null;
}

/** Why a file can't be a character, from its name, size and first
 * bytes; null when it is one. The content decides (a GLB or VRM file,
 * whatever it's called: phones sometimes rename downloads); the name
 * only helps say what's wrong. A .gltf points at other files the
 * browser can't reach. */
export function checkCharacterFile(
  name: string,
  size: number,
  head: Uint8Array,
): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const kind = sniff(head);
  if (kind === "glb")
    return size > MAX_CHARACTER_BYTES
      ? `That file is ${Math.round(size / 1024 / 1024)} MB; the limit is ${MAX_CHARACTER_BYTES / 1024 / 1024} MB.`
      : null;
  if (kind === "image")
    return "That's a picture, not a 3D character. A photo can't be turned into a character here yet. To copy the pose in a photo onto a figure, use Pose › Pose from photo.";
  if (kind === "zip")
    return "That's a zip file: unzip it first, then choose the .glb or .vrm file inside.";
  if (kind === "fbx" || ext === "fbx" || ext === "obj" || ext === "blend")
    return `${kind === "fbx" ? "FBX" : `.${ext}`} files can't be read here: open it in Blender and export it as .glb (File › Export › glTF 2.0, binary).`;
  if (ext === "gltf")
    return "A .gltf file points at other files; export a single .glb (or .vrm) instead.";
  return "That isn't a character file. Choose a .glb or .vrm file with a human skeleton (from VRoid, Mixamo, Blender or Unreal).";
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
  const head = new Uint8Array(
    await file.slice(0, CHARACTER_HEAD_BYTES).arrayBuffer(),
  );
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
