"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addCharacterFile,
  loadCharacters,
  removeCharacter,
  type CharacterEntry,
} from "@/lib/studio/characters";
import { castFileUrl, loadCast, type CastEntry } from "@/lib/studio/cast";

export interface CharacterLibrary {
  /** On this device, oldest first. Empty until loaded. */
  list: CharacterEntry[];
  /** The app's built-in cast (lib/studio/cast.ts). Empty until loaded,
   * or when there is none. */
  cast: CastEntry[];
  /** A file URL per character (the cast's too), for the 3D view. */
  urls: Record<string, string>;
  /** Characters the 3D view couldn't use, and why. */
  problems: Record<string, string>;
  /** Each loaded character's face controls ("expression.happy", ...);
   * absent until the 3D view has loaded it. */
  faces: Record<string, string[]>;
  /** The last import's error, if it failed. */
  error: string | null;
  busy: boolean;
  importFile: (file: File) => Promise<CharacterEntry | null>;
  remove: (id: string) => Promise<void>;
  reportProblem: (id: string, message: string) => void;
  reportFace: (id: string, controls: string[]) => void;
}

/** The device's character library: files in IndexedDB, shown through
 * object URLs that live as long as the page (or the character). */
export function useCharacters(): CharacterLibrary {
  const [list, setList] = useState<CharacterEntry[]>([]);
  const [cast, setCast] = useState<CastEntry[]>([]);
  const [castUrls, setCastUrls] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [faces, setFaces] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const made = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void loadCast().then((c) => {
      if (cancelled) return;
      setCast(c);
      setCastUrls(Object.fromEntries(c.map((e) => [e.id, castFileUrl(e)])));
    });
    loadCharacters()
      .then((all) => {
        if (cancelled) return;
        for (const c of all) made.current[c.id] = URL.createObjectURL(c.blob);
        setList(all.map(({ blob: _blob, ...entry }) => entry));
        setUrls({ ...made.current });
      })
      // No IndexedDB (some private modes): no characters, the rest works.
      .catch(() => {});
    const own = made.current;
    return () => {
      cancelled = true;
      for (const url of Object.values(own)) URL.revokeObjectURL(url);
    };
  }, []);

  const importFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const result = await addCharacterFile(file, list.length);
        if ("error" in result) {
          setError(result.error);
          return null;
        }
        const { entry, blob } = result;
        made.current[entry.id] = URL.createObjectURL(blob);
        setList((l) => [...l, entry]);
        setUrls({ ...made.current });
        return entry;
      } catch {
        setError("The file couldn't be read.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [list.length],
  );

  const remove = useCallback(async (id: string) => {
    await removeCharacter(id).catch(() => {});
    const url = made.current[id];
    delete made.current[id];
    setList((l) => l.filter((c) => c.id !== id));
    setUrls({ ...made.current });
    setProblems(({ [id]: _gone, ...rest }) => rest);
    if (url) URL.revokeObjectURL(url);
  }, []);

  const reportProblem = useCallback((id: string, message: string) => {
    setProblems((p) => (p[id] === message ? p : { ...p, [id]: message }));
  }, []);

  const reportFace = useCallback((id: string, controls: string[]) => {
    setFaces((f) => ({ ...f, [id]: controls }));
  }, []);

  const all = useMemo(() => ({ ...castUrls, ...urls }), [castUrls, urls]);

  return {
    list,
    cast,
    urls: all,
    problems,
    faces,
    error,
    busy,
    importFile,
    remove,
    reportProblem,
    reportFace,
  };
}
