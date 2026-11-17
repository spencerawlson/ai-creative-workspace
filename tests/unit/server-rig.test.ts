import { describe, expect, it } from "vitest";
import { CreatureEntrySchema } from "@/lib/studio/creatures";
import { CreatureIdSchema } from "@/lib/studio/schema";
import {
  asCreatureEntry,
  newDeviceCreatureId,
} from "@/lib/studio/deviceCreatures";
import {
  MAX_RIG_UPLOAD,
  RigError,
  rigKindFrom,
  rigOffered,
  rigRefusal,
  runRig,
} from "@/lib/server/rig";

describe("auto-rigging on the server", () => {
  it("is off unless the server opts in to heavy jobs", () => {
    expect(rigOffered({})).toBe(false);
    expect(rigOffered({ IKO_AUTORIG: "1" })).toBe(true);
    expect(rigOffered({ IKO_BLENDER: "1" })).toBe(true);
    expect(rigOffered({ IKO_AUTORIG: "0" })).toBe(false);
  });

  it("reads what the rigger did, or why it refused", () => {
    expect(rigKindFrom("…\nwrote /tmp/x/out.glb (quadruped rig)\n")).toBe(
      "quadruped",
    );
    expect(rigKindFrom("wrote out.glb (human rig)")).toBe("human");
    expect(rigKindFrom("wrote out.glb (biped rig)")).toBe("biped");
    expect(rigKindFrom("something else")).toBeNull();
    expect(
      rigRefusal(
        "  recognised: other\nError: this model doesn't stand on feet (no separate feet on the floor), so it can't be rigged to walk\n    at autoRig",
      ),
    ).toMatch(/doesn't stand on feet/);
  });

  it("refuses what isn't a GLB, or too big, before starting", async () => {
    await expect(
      runRig(new TextEncoder().encode("hello world!")),
    ).rejects.toMatchObject({
      status: 400,
    });
    const big = new Uint8Array(MAX_RIG_UPLOAD + 1);
    big.set([0x67, 0x6c, 0x54, 0x46]);
    await expect(runRig(big)).rejects.toBeInstanceOf(RigError);
    await expect(runRig(big)).rejects.toMatchObject({ status: 413 });
  });
});

describe("animals rigged on this device", () => {
  it("get ids and entries the app accepts as creatures", () => {
    const id = newDeviceCreatureId();
    expect(CreatureIdSchema.safeParse(id).success).toBe(true);
    expect(id).toMatch(/^creature-u-[0-9a-f]{12}$/);
    const entry = asCreatureEntry(
      { id, name: "My cat", heightMeters: 1, kind: "quadruped", addedAt: 0 },
      12345,
    );
    expect(CreatureEntrySchema.safeParse(entry).success).toBe(true);
    expect(entry.credit.prompt).toMatch(/four-legged/);
  });
});
