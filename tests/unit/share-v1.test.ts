import { describe, expect, it } from "vitest";
import { PRESETS, cloneLights } from "@/lib/lighting";
import { decodeSetup, encodeSetup } from "@/lib/share";

const b64 = (o: unknown) =>
  btoa(JSON.stringify(o))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

describe("v1 share codec (M3 links)", () => {
  it("round-trips every preset to within its 0.1 rounding", () => {
    for (const p of PRESETS) {
      const decoded = decodeSetup(encodeSetup(p.id, cloneLights(p.lights)));
      expect(decoded?.preset).toBe(p.id);
      decoded!.lights.forEach((l, i) => {
        expect(l.intensity).toBeCloseTo(p.lights[i].intensity, 0.9);
        expect({ ...l, intensity: 0 }).toEqual({
          ...p.lights[i],
          intensity: 0,
        });
      });
    }
  });

  it("is lossy for Rembrandt's 0.35 fill (why v2 upgrades restore exact presets)", () => {
    const rembrandt = PRESETS.find((p) => p.id === "rembrandt")!;
    const decoded = decodeSetup(
      encodeSetup("rembrandt", cloneLights(rembrandt.lights)),
    );
    expect(rembrandt.lights[1].intensity).toBe(0.35);
    expect(decoded!.lights[1].intensity).toBe(0.4);
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["garbage", "%%%"],
    ["not json", btoa("hello")],
    ["unknown preset", b64({ p: "disco", l: [] })],
    [
      "two lights",
      b64({
        p: "custom",
        l: [
          [1, 0, 0, 2, 1, 5600, 0, 0],
          [1, 0, 0, 2, 1, 5600, 0, 0],
        ],
      }),
    ],
    [
      "out of range temperature",
      b64({ p: "custom", l: Array(3).fill([1, 0, 0, 2, 1, 99999, 0, 0]) }),
    ],
  ])("rejects %s", (_name, input) => {
    expect(decodeSetup(input as string | null)).toBeNull();
  });
});
