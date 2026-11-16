import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRECISION,
  formatLength,
  lengthField,
  loadPrecision,
  savePrecision,
  snapTo,
} from "@/lib/studio/precision";

describe("precision preferences", () => {
  it("snap to the step, without float dust", () => {
    expect(snapTo(0.37, 0.25)).toBe(0.25);
    expect(snapTo(0.38, 0.25)).toBe(0.5);
    expect(snapTo(-1.06, 0.1)).toBe(-1.1);
    expect(snapTo(0.3, 0.1)).toBe(0.3); // not 0.30000000000000004
  });

  it("show lengths in the chosen units", () => {
    expect(formatLength(1.25, "m")).toBe("1.25 m");
    expect(formatLength(1.25, "cm")).toBe("125 cm");
    expect(formatLength(1.8288, "ft")).toBe("6′ 0″");
    expect(formatLength(1.25, "ft")).toBe("4′ 1″");
    expect(formatLength(-0.3048, "ft")).toBe("−1′ 0″");
  });

  it("scale a metres field into the chosen units", () => {
    expect(lengthField("m", 0.05)).toEqual({
      scale: 1,
      unit: " m",
      step: 0.05,
    });
    expect(lengthField("cm", 0.05)).toEqual({
      scale: 100,
      unit: " cm",
      step: 5,
    });
    const ft = lengthField("ft", 0.05);
    expect(ft.unit).toBe(" ft");
    expect(ft.scale).toBeCloseTo(3.2808, 3);
  });

  it("are kept per device, and bad stored values fall back", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(loadPrecision(storage)).toEqual(DEFAULT_PRECISION);
    const mine = {
      grid: true,
      snap: true,
      step: 0.1 as const,
      units: "cm" as const,
    };
    savePrecision(mine, storage);
    expect(loadPrecision(storage)).toEqual(mine);
    store.set("iko3d.precision", JSON.stringify({ grid: "yes", step: 7 }));
    expect(loadPrecision(storage)).toEqual(DEFAULT_PRECISION);
    store.set("iko3d.precision", "{not json");
    expect(loadPrecision(storage)).toEqual(DEFAULT_PRECISION);
  });
});
