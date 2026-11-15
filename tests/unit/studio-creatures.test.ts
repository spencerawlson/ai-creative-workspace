import { describe, expect, it } from "vitest";
import { applyAction, describeAction } from "@/lib/studio/actions";
import { creatureFileUrl, readCreaturesList } from "@/lib/studio/creatures";
import { defaultScene } from "@/lib/studio/presets";
import { FigureSchema } from "@/lib/studio/schema";
import { decodeScene, encodeScene } from "@/lib/studio/share";

const lion = {
  id: "creature-lion",
  name: "Lion",
  file: "lion.glb",
  size: 1_080_000,
  heightMeters: 1.1,
  credit: { tool: "Meshy", prompt: "a lion", made: "2026-11-15" },
};

describe("the built-in creatures", () => {
  it("reads the list, leaving out entries that don't fit", () => {
    expect(readCreaturesList({ version: 1, creatures: [] })).toEqual([]);
    expect(readCreaturesList(null)).toEqual([]);
    expect(readCreaturesList({ version: 2, creatures: [lion] })).toEqual([]);
    expect(
      readCreaturesList({
        version: 1,
        creatures: [
          lion,
          { ...lion, id: "cast-lion" },
          { ...lion, id: "creature-up", file: "../../secret.glb" },
          { ...lion, id: "creature-rat", heightMeters: 0.05 },
        ],
      }),
    ).toEqual([lion]);
    expect(creatureFileUrl(lion)).toBe("/creatures/lion.glb");
  });

  it("a figure can be a creature, and share links keep it", () => {
    const r = applyAction(defaultScene(), {
      type: "setCreature",
      figure: "fig-1",
      creature: "creature-lion",
      name: "Lion",
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.scene.figures[0].creature).toBe("creature-lion");
    expect(decodeScene(encodeScene(r.scene))!.figures[0].creature).toBe(
      "creature-lion",
    );
    expect(
      applyAction(defaultScene(), {
        type: "setCreature",
        figure: "fig-1",
        creature: "creature-../x",
      }).ok,
    ).toBe(false);
    expect(
      describeAction(r.scene, {
        type: "setCreature",
        figure: "fig-1",
        creature: "creature-lion",
        name: "Lion",
      }),
    ).toBe("Creature: Lion");
  });

  it("a figure shows one or the other, never both", () => {
    const withCharacter = applyAction(defaultScene(), {
      type: "setCharacter",
      figure: "fig-1",
      character: "cast-dancer",
      name: "Dancer",
    });
    if (!withCharacter.ok) throw new Error(withCharacter.error);
    const withCreature = applyAction(withCharacter.scene, {
      type: "setCreature",
      figure: "fig-1",
      creature: "creature-lion",
      name: "Lion",
    });
    if (!withCreature.ok) throw new Error(withCreature.error);
    expect(withCreature.scene.figures[0].creature).toBe("creature-lion");
    expect(withCreature.scene.figures[0].character).toBeUndefined();
    const backToCharacter = applyAction(withCreature.scene, {
      type: "setCharacter",
      figure: "fig-1",
      character: "cast-dancer",
      name: "Dancer",
    });
    if (!backToCharacter.ok) throw new Error(backToCharacter.error);
    expect(backToCharacter.scene.figures[0].character).toBe("cast-dancer");
    expect(backToCharacter.scene.figures[0].creature).toBeUndefined();
    const backToMannequin = applyAction(backToCharacter.scene, {
      type: "setCharacter",
      figure: "fig-1",
      character: null,
    });
    if (!backToMannequin.ok) throw new Error(backToMannequin.error);
    expect(backToMannequin.scene.figures[0].creature).toBeUndefined();
    expect(backToMannequin.scene.figures[0].character).toBeUndefined();
    // Clearing a creature alone leaves a character untouched.
    const clearCreature = applyAction(withCreature.scene, {
      type: "setCreature",
      figure: "fig-1",
      creature: null,
    });
    if (!clearCreature.ok) throw new Error(clearCreature.error);
    expect(clearCreature.scene.figures[0].creature).toBeUndefined();
  });

  it("the figure schema only accepts a creature id that fits", () => {
    const base = defaultScene().figures[0];
    expect(
      FigureSchema.safeParse({ ...base, creature: "creature-lion" }).success,
    ).toBe(true);
    expect(FigureSchema.safeParse({ ...base, creature: "lion" }).success).toBe(
      false,
    );
    expect(
      FigureSchema.safeParse({ ...base, creature: "cast-lion" }).success,
    ).toBe(false);
  });
});
