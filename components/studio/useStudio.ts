"use client";

/** Studio state: undoable scene history plus the side effects around it
 * (URL sync, local autosave, startup restore). Components call
 * `dispatch(action)`; nothing else mutates the scene. */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { SceneAction } from "@/lib/studio/actions";
import {
  canRedo,
  canUndo,
  createHistory,
  historyReducer,
  present,
} from "@/lib/studio/history";
import { loadAutosave, saveAutosave } from "@/lib/studio/persistence";
import { defaultScene } from "@/lib/studio/presets";
import { decodeSceneLink, encodeSceneLink } from "@/lib/studio/share";
import { isAnimated } from "@/lib/studio/speech";
import type { CameraPlacement } from "@/lib/studio/schema";

export const DEFAULT_PROJECT_NAME = "Untitled lighting setup";

export type Notice = { id: number; tone: "info" | "error"; text: string };

/** Actions that change keyframes rather than the scene shown. */
const KEY_EDITS = new Set<SceneAction["type"]>([
  "setKeyValue",
  "setKeyTangent",
  "setKeyTangents",
  "setKeyEase",
  "moveKey",
  "deleteKey",
  "clearKeys",
  "applyMotion",
]);

export interface TimelineState {
  t: number;
  autoKey: boolean;
  /** The camera view to record in keys, or undefined to not key it. */
  camera: () => CameraPlacement | undefined;
}

export function useStudio() {
  const [history, send] = useReducer(historyReducer, undefined, () =>
    createHistory(defaultScene()),
  );
  const [name, setName] = useState(DEFAULT_PROJECT_NAME);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0);
  const scene = present(history);

  const notify = useCallback((text: string, tone: Notice["tone"] = "info") => {
    setNotice({ id: ++noticeId.current, tone, text });
  }, []);

  /** Set by the timeline: the current time, whether auto-key is on,
   * and the camera view to key. Read at dispatch time, so every edit —
   * slider, viewport drag, preset — is keyed the same way. */
  const timeline = useRef<TimelineState | null>(null);

  /** `gesture`: part of a viewport drag; merges until `seal`. */
  const dispatch = useCallback(
    (action: SceneAction, opts?: { gesture?: boolean }) => {
      const tl = timeline.current;
      send({
        type: "commit",
        action,
        now: performance.now(),
        gesture: opts?.gesture,
        autoKey: tl?.autoKey ? { t: tl.t, camera: tl.camera() } : undefined,
      });
      // Editing the keys themselves (graph editor, timeline) changes
      // what the playhead shows: show it again. Ordinary edits stay as
      // they are until the playhead moves, keyed or not.
      if (tl && KEY_EDITS.has(action.type)) send({ type: "showTime", t: tl.t });
    },
    [],
  );
  const showTime = useCallback(
    (t: number) => send({ type: "showTime", t }),
    [],
  );
  // After undo/redo the figures should again match the playhead.
  const resync = useCallback(() => {
    const tl = timeline.current;
    if (tl) send({ type: "showTime", t: tl.t });
  }, []);
  const seal = useCallback(() => send({ type: "seal" }), []);
  const undo = useCallback(() => {
    send({ type: "undo" });
    resync();
  }, [resync]);
  const redo = useCallback(() => {
    send({ type: "redo" });
    resync();
  }, [resync]);
  const jump = useCallback(
    (index: number) => {
      send({ type: "jump", index });
      resync();
    },
    [resync],
  );

  // Rejected actions (out of range, unknown light, too many lights).
  useEffect(() => {
    if (history.error) notify(history.error, "error");
  }, [history.error, notify]);

  // Startup: a share link wins, then the last autosave, then defaults.
  useEffect(() => {
    let cancelled = false;
    const param = new URLSearchParams(window.location.search).get("s");
    if (param) {
      // Animated links are compressed, so opening one is async.
      void decodeSceneLink(param).then((shared) => {
        if (cancelled) return;
        if (shared) {
          send({ type: "replace", scene: shared, label: "Open shared link" });
          notify(
            isAnimated(shared)
              ? "Opened a shared animation. Press Space to play it."
              : "Opened a shared lighting setup.",
          );
        } else {
          notify(
            "That share link is damaged or from a newer version — showing the default setup.",
            "error",
          );
        }
        setHydrated(true);
      });
      return () => {
        cancelled = true;
      };
    } else {
      const saved = loadAutosave();
      if (saved) {
        send({
          type: "replace",
          scene: saved.scene,
          label: "Restore last session",
        });
        setName(saved.name);
        setSavedAt(saved.savedAt);
      }
    }
    setHydrated(true);
    return () => {
      cancelled = true;
    };
  }, [notify]);

  // Keep the address bar a live share link, and autosave locally.
  useEffect(() => {
    if (!hydrated) return;
    let stale = false;
    const t = setTimeout(async () => {
      const now = Date.now();
      if (saveAutosave({ savedAt: now, name, scene })) setSavedAt(now);
      const { param } = await encodeSceneLink(scene);
      if (stale) return; // a newer scene is on its way
      const url = new URL(window.location.href);
      if (url.searchParams.get("s") !== param) {
        url.searchParams.set("s", param);
        window.history.replaceState(null, "", url.toString());
      }
    }, 400);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [hydrated, scene, name]);

  /** The share link, and whether it carries the animation. */
  const shareUrl = useCallback(async () => {
    const link = await encodeSceneLink(scene);
    const url = new URL(window.location.href);
    url.searchParams.set("s", link.param);
    return { ...link, url: url.toString() };
  }, [scene]);

  return useMemo(
    () => ({
      scene,
      history,
      dispatch,
      seal,
      undo,
      redo,
      jump,
      showTime,
      timeline,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      name,
      setName,
      hydrated,
      savedAt,
      notice,
      notify,
      shareUrl,
    }),
    [
      scene,
      history,
      dispatch,
      seal,
      undo,
      redo,
      jump,
      showTime,
      name,
      hydrated,
      savedAt,
      notice,
      notify,
      shareUrl,
    ],
  );
}

export type Studio = ReturnType<typeof useStudio>;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that block the async clipboard API.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "lighting"
  );
}
