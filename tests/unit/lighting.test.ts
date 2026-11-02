import { describe, expect, it } from "vitest";
import {
  PRESETS,
  cloneLights,
  kelvinToRgb,
  lightPosition,
} from "@/lib/lighting";
import { focalToFov } from "@/lib/photography";

describe("lighting presets", () => {
  it("keeps all six curated presets, each with key/fill/rim and a note", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "three-point",
      "rembrandt",
      "split",
      "butterfly",
      "low-key",
      "high-key",
    ]);
    for (const p of PRESETS) {
      expect(p.lights.map((l) => l.id)).toEqual(["key", "fill", "rim"]);
      expect(p.note.length).toBeGreaterThan(80);
    }
  });

  it("presets are visibly different from each other", () => {
    const sigs = PRESETS.map((p) => JSON.stringify(p.lights));
    expect(new Set(sigs).size).toBe(PRESETS.length);
  });

  it("cloneLights returns deep copies", () => {
    const copy = cloneLights(PRESETS[0].lights);
    copy[0].intensity = 99;
    expect(PRESETS[0].lights[0].intensity).not.toBe(99);
  });
});

describe("kelvinToRgb", () => {
  it("keeps the M2 stops exactly", () => {
    expect(kelvinToRgb(2700)).toEqual([1.0, 0.62, 0.32]);
    expect(kelvinToRgb(5600)).toEqual([1.0, 0.97, 0.92]);
    expect(kelvinToRgb(6500)).toEqual([0.94, 0.96, 1.0]);
  });

  it("interpolates and clamps to the extended 2000–9000K range", () => {
    const mid = kelvinToRgb(3100);
    expect(mid[1]).toBeGreaterThan(0.62);
    expect(mid[1]).toBeLessThan(0.78);
    expect(kelvinToRgb(100)).toEqual(kelvinToRgb(2000));
    expect(kelvinToRgb(20000)).toEqual(kelvinToRgb(9000));
  });
});

describe("lightPosition", () => {
  const near = (a: number[], b: number[]) =>
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

  it("0° azimuth is in front (+Z), 90° is +X, at the pivot height", () => {
    near(
      lightPosition({ azimuth: 0, elevation: 0, distance: 4 }),
      [0, 0.95, 4],
    );
    near(
      lightPosition({ azimuth: 90, elevation: 0, distance: 4 }),
      [4, 0.95, 0],
    );
  });

  it("elevation raises the light on the sphere", () => {
    near(
      lightPosition({ azimuth: 0, elevation: 90, distance: 2 }),
      [0, 2.95, 0],
    );
  });
});

describe("photography focalToFov", () => {
  it("maps 50mm to ~27° and clamps to 24–85mm", () => {
    expect(focalToFov(50)).toBeCloseTo(26.99, 1);
    expect(focalToFov(10)).toBe(focalToFov(24));
  });
});
