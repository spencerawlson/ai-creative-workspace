"use client";

import { useRef } from "react";
import { PawPrint, Trash2, Upload, UserRound } from "lucide-react";
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
          <li key={c.id} className="flex">
            {creatureOption(c.id, c.name, "walks")}
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
      <p
        className="mt-1.5 text-2xs leading-snug text-ink-400"
        aria-live="polite"
        data-testid="character-status"
      >
        {characters.error ??
          problem ??
          (creature
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
