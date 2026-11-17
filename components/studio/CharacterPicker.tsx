"use client";

import { useEffect, useRef, useState } from "react";
import { PawPrint, Trash2, Upload, UserRound, Wand2 } from "lucide-react";
import { loadCharacters } from "@/lib/studio/characters";
import type { Figure } from "@/lib/studio/schema";
import type { CharacterLibrary } from "./useCharacters";
import type { CreatureLibrary } from "./useCreatures";
import type { Studio } from "./useStudio";
import { Button, IconButton, SectionTitle, cx } from "./ui";

const mb = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Which character a figure shows: the mannequin, one of the app's
 * built-in cast (when it has one), one imported onto this device
 * (GLB or VRM, with a human skeleton), or one of the app's built-in
 * creatures — an animal, which walks on its own baked walk cycle but
 * can't be posed. Importing puts the new character on this figure. */
export function CharacterPicker({
  studio,
  figure,
  characters,
  creatures,
}: {
  studio: Studio;
  figure: Figure;
  characters: CharacterLibrary;
  creatures: CreatureLibrary;
}) {
  const { dispatch } = studio;
  const input = useRef<HTMLInputElement>(null);
  const current = figure.character ?? null;
  const currentCreature = figure.creature ?? null;
  const member = characters.cast.find((c) => c.id === current);
  const creature = creatures.list.find((c) => c.id === currentCreature);
  const missing =
    current !== null &&
    !member &&
    !characters.list.some((c) => c.id === current);
  const problem = current ? characters.problems[current] : undefined;
  // A model with no skeleton: the server may rig it (app/api/rig).
  const noSkeleton = !!problem && /no skeleton/i.test(problem);
  const [canRig, setCanRig] = useState(false);
  const [rigging, setRigging] = useState(false);
  const [rigNote, setRigNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/rig")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setCanRig(!!j?.available))
      .catch(() => live && setCanRig(false));
    return () => {
      live = false;
    };
  }, []);
  const ownCreature = creature ? creatures.onDevice.has(creature.id) : false;
  const choose = (id: string | null, name?: string) =>
    dispatch({
      type: "setCharacter",
      figure: figure.id,
      character: id,
      ...(name ? { name } : {}),
    });
  const chooseCreature = (id: string | null, name?: string) =>
    dispatch({
      type: "setCreature",
      figure: figure.id,
      creature: id,
      ...(name ? { name } : {}),
    });

  const option = (
    id: string | null,
    label: string,
    detail: string | null,
    testId: string,
  ) => (
    <button
      type="button"
      aria-pressed={current === id && currentCreature === null}
      data-testid={testId}
      onClick={() => choose(id, id ? label : undefined)}
      className={cx(
        "flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors sm:min-h-8",
        current === id && currentCreature === null
          ? "bg-accent-soft text-ink-100 ring-1 ring-accent"
          : "text-ink-200 hover:bg-ink-750",
      )}
    >
      <UserRound aria-hidden className="h-4 w-4 shrink-0 text-ink-400" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && (
        <span className="shrink-0 text-2xs text-ink-400">{detail}</span>
      )}
    </button>
  );

  /** Send the current (skeleton-less) character to be rigged; a human
   * comes back as a character, an animal as a creature on this device. */
  const rig = async () => {
    const id = current;
    if (!id) return;
    const entry = characters.list.find((c) => c.id === id);
    const stored = (await loadCharacters()).find((c) => c.id === id);
    if (!entry || !stored) return;
    setRigging(true);
    setRigNote("Recognising the body and rigging it… (about a minute)");
    try {
      const res = await fetch("/api/rig", {
        method: "POST",
        body: stored.blob,
        headers: { "Content-Type": "model/gltf-binary" },
      });
      if (!res.ok) {
        const why = await res.json().catch(() => null);
        throw new Error(why?.error ?? "The model couldn't be rigged.");
      }
      const kind = res.headers.get("X-IKO-Rig") ?? "";
      const blob = await res.blob();
      if (kind === "human") {
        const again = await characters.importFile(
          new File([blob], `${entry.name}.glb`, { type: "model/gltf-binary" }),
        );
        if (!again) throw new Error("The rigged character couldn't be kept.");
        await characters.remove(id);
        choose(again.id, again.name);
        setRigNote(`Rigged as a person: ${again.name} now takes every pose.`);
      } else {
        const added = await creatures.add?.(blob, entry.name, kind);
        if (!added || "error" in added)
          throw new Error(added?.error ?? "The animal couldn't be kept.");
        await characters.remove(id);
        chooseCreature(added.id, entry.name);
        setRigNote(
          `Recognised as a ${kind === "quadruped" ? "four-legged" : "two-legged"} animal and rigged: ${entry.name} walks — type “walk”.`,
        );
      }
    } catch (e) {
      setRigNote(
        e instanceof Error ? e.message : "The model couldn't be rigged.",
      );
    } finally {
      setRigging(false);
    }
  };

  const creatureOption = (id: string, label: string, detail: string) => (
    <button
      type="button"
      aria-pressed={currentCreature === id}
      data-testid={`creature-${id}`}
      onClick={() => chooseCreature(id, label)}
      className={cx(
        "flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors sm:min-h-8",
        currentCreature === id
          ? "bg-accent-soft text-ink-100 ring-1 ring-accent"
          : "text-ink-200 hover:bg-ink-750",
      )}
    >
      <PawPrint aria-hidden className="h-4 w-4 shrink-0 text-ink-400" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-2xs text-ink-400">{detail}</span>
    </button>
  );

  return (
    <div data-testid="character-picker">
      <SectionTitle>Character</SectionTitle>
      <ul className="mt-1.5 space-y-1">
        <li className="flex">
          {option(null, "Mannequin", null, "character-none")}
        </li>
        {characters.cast.length > 0 && (
          <li
            className="px-1 pt-1 text-2xs font-medium uppercase tracking-wide text-ink-400"
            aria-hidden
          >
            Cast
          </li>
        )}
        {characters.cast.map((c) => (
          <li key={c.id} className="flex">
            {option(c.id, c.name, "built in", `character-${c.id}`)}
          </li>
        ))}
        {creatures.list.length > 0 && (
          <li
            className="px-1 pt-1 text-2xs font-medium uppercase tracking-wide text-ink-400"
            aria-hidden
          >
            Creatures
          </li>
        )}
        {creatures.list.map((c) => (
          <li key={c.id} className="flex items-center gap-1">
            {creatureOption(
              c.id,
              c.name,
              creatures.onDevice.has(c.id) ? "yours · walks" : "walks",
            )}
            {creatures.onDevice.has(c.id) && creatures.remove && (
              <IconButton
                icon={Trash2}
                size="sm"
                label={`Remove ${c.name} from this device`}
                data-testid={`creature-remove-${c.id}`}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove "${c.name}" from this device? Figures using it go back to the mannequin.`,
                    )
                  ) {
                    if (currentCreature === c.id) chooseCreature(null);
                    void creatures.remove?.(c.id);
                  }
                }}
              />
            )}
          </li>
        ))}
        {characters.list.length > 0 && characters.cast.length > 0 && (
          <li
            className="px-1 pt-1 text-2xs font-medium uppercase tracking-wide text-ink-400"
            aria-hidden
          >
            On this device
          </li>
        )}
        {characters.list.map((c) => (
          <li key={c.id} className="flex items-center gap-1">
            {option(c.id, c.name, mb(c.size), `character-${c.id}`)}
            <IconButton
              icon={Trash2}
              size="sm"
              label={`Remove ${c.name} from this device`}
              data-testid={`character-remove-${c.id}`}
              onClick={() => {
                if (
                  window.confirm(
                    `Remove "${c.name}" from this device? Figures using it go back to the mannequin.`,
                  )
                )
                  void characters.remove(c.id);
              }}
            />
          </li>
        ))}
      </ul>
      <input
        ref={input}
        type="file"
        // No extension filter: iPhone and iPad don't know .glb or .vrm and
        // grey those files out. Any file can be chosen; the import checks
        // the content and says what's wrong.
        className="hidden"
        data-testid="character-file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const entry = await characters.importFile(file);
          if (entry) choose(entry.id, entry.name);
        }}
      />
      <Button
        size="sm"
        icon={Upload}
        className="mt-2 w-full"
        disabled={characters.busy}
        data-testid="character-import"
        onClick={() => input.current?.click()}
      >
        {characters.busy ? "Importing…" : "Import character (.glb, .vrm)"}
      </Button>
      {noSkeleton && canRig && (
        <Button
          size="sm"
          variant="primary"
          icon={Wand2}
          className="mt-1.5 w-full"
          disabled={rigging}
          data-testid="character-autorig"
          onClick={() => void rig()}
        >
          {rigging ? "Rigging…" : "Rig it automatically"}
        </Button>
      )}
      <p
        className="mt-1.5 text-2xs leading-snug text-ink-400"
        aria-live="polite"
        data-testid="character-status"
      >
        {characters.error ??
          rigNote ??
          (noSkeleton && canRig
            ? `${problem} Or let the app rig it: it recognises a person (who then takes every pose) or an animal (which then walks).`
            : problem) ??
          (creature && ownCreature
            ? `${creature.name}: rigged on this device (${creature.credit.prompt}). It walks — type “walk” — and stays on this device: share links show the mannequin elsewhere.`
            : creature
              ? `${creature.name}: made with ${creature.credit.tool} from the description “${creature.credit.prompt}”. Built in, so share links show it on every device. It walks with its own baked walk cycle — type “walk” — but it has no human skeleton, so it can't be posed. Move it and turn it as usual.`
              : member
                ? `${member.name}: made with ${member.credit.tool} from the description “${member.credit.prompt}”. Built in, so share links show it on every device.`
                : missing
                  ? "This figure's character isn't on this device, so the mannequin stands in."
                  : "Needs a human skeleton (VRoid, Mixamo, Blender, Unreal). Files stay on this device; share links show the mannequin. Only use characters you have the right to, and no real person's likeness without their consent.")}
      </p>
    </div>
  );
}
