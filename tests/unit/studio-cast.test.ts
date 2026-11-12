import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/studio/actions";
import { castFileUrl, readCastList } from "@/lib/studio/cast";
import { defaultScene } from "@/lib/studio/presets";
import { decodeScene, encodeScene } from "@/lib/studio/share";

const dancer = {
  id: "cast-dancer",
  name: "Dancer",
  file: "dancer.glb",
  size: 4_200_000,
  credit: { tool: "Meshy", prompt: "a dancer", made: "2026-11-18" },
};

describe("the built-in cast", () => {
  it("reads the list, leaving out entries that don't fit", () => {
    expect(readCastList({ version: 1, cast: [] })).toEqual([]);
    expect(readCastList(null)).toEqual([]);
    expect(readCastList({ version: 2, cast: [dancer] })).toEqual([]);
    expect(
      readCastList({
        version: 1,
        cast: [
          dancer,
          { ...dancer, id: "ch-notcast" },
          { ...dancer, id: "cast-up", file: "../../secret.glb" },
        ],
      }),
    ).toEqual([dancer]);
    expect(castFileUrl(dancer)).toBe("/cast/dancer.glb");
  });

  it("a figure can be a cast member, and share links keep it", () => {
    const r = applyAction(defaultScene(), {
      type: "setCharacter",
      figure: "fig-1",
      character: "cast-dancer",
      name: "Dancer",
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.scene.figures[0].character).toBe("cast-dancer");
    expect(decodeScene(encodeScene(r.scene))!.figures[0].character).toBe(
      "cast-dancer",
    );
    expect(
      applyAction(defaultScene(), {
        type: "setCharacter",
        figure: "fig-1",
        character: "cast-../x",
      }).ok,
    ).toBe(false);
  });
});
