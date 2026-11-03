import { useCallback, useEffect, useRef } from "react";
import type { Selection } from "@/lib/engine/StudioEngine";
import type { Figure } from "@/lib/studio/schema";

/** Call the returned function just before dispatching an action that
 * adds a figure; once the new scene arrives, the new figure's
 * mannequin controls are selected. */
export function useSelectNewFigure(
  figures: Figure[],
  onSelect: (s: Selection, figure?: string) => void,
): () => void {
  const before = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = before.current;
    if (!ids) return;
    before.current = null;
    const added = figures.find((f) => !ids.has(f.id));
    if (added) onSelect("model", added.id);
  }, [figures, onSelect]);
  return useCallback(() => {
    before.current = new Set(figures.map((f) => f.id));
  }, [figures]);
}
