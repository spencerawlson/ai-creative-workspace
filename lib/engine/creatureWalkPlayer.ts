/** A creature's baked walk clip, played at an absolute phase.
 *
 * The studio drives the clip from the keyframed walk (how far the body
 * has travelled, or the clock for a walk on the spot), never from
 * wall-clock time, so scrubbing, pausing and video recording all show
 * the same legs. The mixer is never advanced by delta: the caller sets
 * the phase outright on every frame (lib/studio/creatureWalk.ts).
 *
 * The bind pose is restored, not faked: the clip's frame 0 is mid-stride,
 * so "standing" means the bones as the file shipped them, which the
 * mixer itself returns to when the action's weight is 0 — and this
 * player also restores the recorded bind transforms outright. */

import * as THREE from "three";

export interface CreatureWalkPlayer {
  /** Seconds per loop, from the clip itself. */
  readonly duration: number;
  /** Pose the clip at `phase` (0..1 of the loop), blended in by
   * `weight` (0 = the bind pose); null poses the bind pose. */
  setPhase(phase: number | null, weight?: number): void;
  dispose(): void;
}

/** The clip on a figure's own clone (never the shared template): the
 * mixer binds the clip's tracks to this clone's bones by name. Null
 * when the clip has nothing to play. */
export function attachCreatureWalk(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
): CreatureWalkPlayer | null {
  if (clip.tracks.length === 0) return null;
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();
  // The bind pose, to come back to when the walk stops: every node the
  // clip moves, as it stands before the clip runs.
  const bind = new Map<
    THREE.Object3D,
    { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }
  >();
  for (const track of clip.tracks) {
    const node = root.getObjectByName(track.name.split(".")[0]);
    if (node && !bind.has(node))
      bind.set(node, {
        p: node.position.clone(),
        q: node.quaternion.clone(),
        s: node.scale.clone(),
      });
  }
  const restore = () => {
    for (const [node, b] of bind) {
      node.position.copy(b.p);
      node.quaternion.copy(b.q);
      node.scale.copy(b.s);
    }
  };
  return {
    duration: clip.duration,
    setPhase(phase, weight = 1) {
      if (phase === null || weight <= 0) {
        action.weight = 0;
        mixer.update(0);
        restore();
        return;
      }
      action.weight = Math.min(1, Math.max(0, weight));
      action.time = (((phase % 1) + 1) % 1) * clip.duration;
      mixer.update(0);
    },
    dispose() {
      action.stop();
      mixer.uncacheClip(clip);
      mixer.uncacheRoot(root);
    },
  };
}
