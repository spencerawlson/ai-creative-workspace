import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { describe, expect, it } from "vitest";
import { attachCreatureWalk } from "@/lib/engine/creatureWalkPlayer";
import { CREATURE_WALK_CLIP_NAME } from "@/lib/studio/creatureWalk";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** The served GLB, through the same loader (and meshopt decoder) the
 * studio uses — file bytes, no network. */
async function loadCreature(file: string) {
  const bytes = readFileSync(`${root}public/creatures/${file}`);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
}

/** A bone's swing about its local X — the axis the walk rotates a limb
 * about — relative to its bind pose, in degrees. */
function swingDeg(bone: THREE.Object3D, bind: THREE.Quaternion): number {
  const angle = (q: THREE.Quaternion) =>
    (2 * Math.atan2(q.x, q.w) * 180) / Math.PI;
  const d = angle(bone.quaternion) - angle(bind);
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

describe("the served creature GLBs", () => {
  it("each carries exactly one animation, the 1 s walk loop", async () => {
    const files = readdirSync(`${root}public/creatures`).filter((f) =>
      f.endsWith(".glb"),
    );
    expect(files.length).toBe(12);
    for (const file of files) {
      const gltf = await loadCreature(file);
      expect(gltf.animations.length, file).toBe(1);
      const clip = gltf.animations[0];
      expect(clip.name, file).toBe(CREATURE_WALK_CLIP_NAME);
      expect(clip.duration, file).toBeCloseTo(1, 5);
      expect(clip.tracks.length, file).toBeGreaterThan(0);
      let skinned = 0;
      gltf.scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned++;
      });
      expect(skinned, file).toBe(1);
    }
  });
});

describe("the creature walk player", () => {
  it("plays the lion's walk on its own clone: legs swing in opposite phase, and the loop closes", async () => {
    const gltf = await loadCreature("lion.glb");
    const clip = gltf.animations[0];
    // The engine's path: a clone of the prepared model, never the template.
    const object = cloneSkinned(gltf.scene);
    const legFL = object.getObjectByName("legFL")!;
    const legFR = object.getObjectByName("legFR")!;
    const bindFL = legFL.quaternion.clone();
    const bindFR = legFR.quaternion.clone();
    const player = attachCreatureWalk(object, clip);
    expect(player).not.toBeNull();
    expect(player!.duration).toBeCloseTo(1, 5);

    // The clip's own swing: front legs ±22°, in opposite phase.
    const at = (phase: number) => {
      player!.setPhase(phase);
      return {
        fl: swingDeg(legFL, bindFL),
        fr: swingDeg(legFR, bindFR),
      };
    };
    expect(at(0)).toEqual({
      fl: expect.closeTo(0, 1),
      fr: expect.closeTo(0, 1),
    });
    const quarter = at(0.25);
    expect(quarter.fl).toBeCloseTo(22, 0);
    expect(quarter.fr).toBeCloseTo(-22, 0);
    const half = at(0.5);
    expect(half.fl).toBeCloseTo(0, 1);
    expect(half.fr).toBeCloseTo(0, 1);
    const threeQuarter = at(0.75);
    expect(threeQuarter.fl).toBeCloseTo(-22, 0);
    expect(threeQuarter.fr).toBeCloseTo(22, 0);
    // The loop closes: phase 1 is phase 0, on the same bones.
    expect(at(1)).toEqual(at(0));
    // The legs sweep the full swing over a cycle (phase 0 and 0.5 are
    // both neutral crossings, so distinct poses are counted by range).
    const swings = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map(
      (p) => at(p).fl,
    );
    expect(Math.max(...swings)).toBeCloseTo(22, 0);
    expect(Math.min(...swings)).toBeCloseTo(-22, 0);

    // Stopping returns every animated bone to the bind pose.
    player!.setPhase(null);
    expect(legFL.quaternion.equals(bindFL)).toBe(true);
    expect(legFR.quaternion.equals(bindFR)).toBe(true);

    // A half blend is half the swing: the fade in and out.
    player!.setPhase(0.25, 0.5);
    expect(swingDeg(legFL, bindFL)).toBeCloseTo(11, 0);
    player!.dispose();
  });
});
