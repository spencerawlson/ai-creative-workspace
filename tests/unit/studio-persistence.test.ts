import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_KEY,
  loadAutosave,
  parseProject,
  saveAutosave,
  serializeProject,
} from "@/lib/studio/persistence";
import { defaultScene } from "@/lib/studio/presets";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

describe("autosave", () => {
  it("saves and restores", () => {
    const kv = memory();
    const data = { savedAt: 1, name: "A", scene: defaultScene() };
    expect(saveAutosave(data, kv)).toBe(true);
    expect(loadAutosave(kv)?.scene).toEqual(defaultScene());
  });

  it("ignores corrupt or invalid data", () => {
    const kv = memory();
    kv.m.set(AUTOSAVE_KEY, "{not json");
    expect(loadAutosave(kv)).toBeNull();
    kv.m.set(
      AUTOSAVE_KEY,
      JSON.stringify({ savedAt: 1, name: "x", scene: { version: 2 } }),
    );
    expect(loadAutosave(kv)).toBeNull();
  });

  it("survives storage that throws (private mode, quota)", () => {
    const kv = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    const data = { savedAt: 1, name: "A", scene: defaultScene() };
    expect(saveAutosave(data, kv)).toBe(false);
    expect(loadAutosave(kv)).toBeNull();
  });
});

describe("project files", () => {
  it("round-trips", () => {
    const text = serializeProject("My setup", defaultScene(), new Date(0));
    const r = parseProject(text);
    expect(r.ok && r.project.name).toBe("My setup");
    expect(r.ok && r.project.scene).toEqual(defaultScene());
  });

  it("rejects non-JSON, wrong format, and invalid scenes with a message", () => {
    expect(parseProject("nope")).toMatchObject({ ok: false });
    expect(parseProject(JSON.stringify({ format: "other" }))).toMatchObject({
      ok: false,
    });
    const bad = JSON.parse(serializeProject("x", defaultScene()));
    bad.scene.lights = [];
    const r = parseProject(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/lights/);
  });
});
