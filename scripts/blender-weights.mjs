// Skin weights from Blender's automatic weights, onto our own skeleton:
// `node scripts/blender-weights.mjs in.glb out.glb`.
//
// The model (a rigged GLB: our skeleton, any weights) goes to Blender as
// a plain GLB with each bone's segment (scripts/reskin-cast.mjs's
// boneSegments, the same bones bone heat uses); Blender weights it
// (scripts/blender/auto_weights.py) and only the weights come back,
// matched to our vertices by position. Skeleton, bind pose and
// everything else stay as they were. Slimmed as the cast is.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize, meshopt, quantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { runBlender } from "./blender/run.mjs";
import { bindMatrix, boneSegments } from "./reskin-cast.mjs";

async function io() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });
}

/** Replace the weights of `doc` (dequantised in place) with Blender's
 * automatic weights. */
export async function blenderWeights(
  doc,
  glb,
  {
    everyBone = false,
    skinFrom = {},
    segmentsFor = null,
    exclude = [],
    log = console.log,
  } = {},
) {
  await doc.transform(dequantize());
  const root = doc.getRoot();
  for (const e of root.listExtensionsUsed())
    if (
      ["EXT_meshopt_compression", "KHR_mesh_quantization"].includes(
        e.extensionName,
      )
    )
      e.dispose();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const node = root
    .listNodes()
    .find((n) => n.getMesh() && n.getSkin() === skin);
  const prim = node.getMesh().listPrimitives()[0];
  // Rest positions through the skin's bind (not the node transform).
  const m = bindMatrix(skin);
  const pos = prim.getAttribute("POSITION");
  const n = pos.getCount();
  const P = new Float64Array(n * 3);
  const a = [];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, a);
    for (let k = 0; k < 3; k++)
      P[i * 3 + k] =
        m[k] * a[0] + m[4 + k] * a[1] + m[8 + k] * a[2] + m[12 + k];
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, P[i * 3 + 1]);
    maxY = Math.max(maxY, P[i * 3 + 1]);
  }
  const world = new Map(joints.map((j) => [j, j.getWorldTranslation()]));
  const segments = boneSegments(joints, world, P, minY, maxY);
  // A bone whose skin starts past its pivot (a finger: from where it
  // shows, not from its knuckle inside the palm).
  for (const seg of segments)
    if (skinFrom[seg.name]) seg.a = skinFrom[seg.name];
  // A freshly fitted skeleton knows each bone's line exactly (an
  // animal's chest has a neck and two legs below it, so "towards its
  // main child" can't say which): use those lines.
  if (segmentsFor)
    for (const seg of segments)
      if (segmentsFor[seg.name]) [seg.a, seg.b] = segmentsFor[seg.name];
  // Only bones the current weights use deform (an animal rig's root, on
  // the floor, mustn't claim the belly).
  const used = new Float64Array(joints.length);
  const J0 = prim.getAttribute("JOINTS_0");
  const W0 = prim.getAttribute("WEIGHTS_0");
  const jj = [];
  const ww = [];
  for (let i = 0; i < n; i++) {
    J0.getElement(i, jj);
    W0.getElement(i, ww);
    for (let k = 0; k < 4; k++) used[jj[k]] += ww[k];
  }
  const bones = Object.fromEntries(
    segments
      .filter(
        (s, j) => !exclude.includes(s.name) && (everyBone || used[j] > 1e-3),
      )
      .map((s) => [s.name, [s.a, s.b]]),
  );

  const dir = mkdtempSync(join(tmpdir(), "iko-weights-"));
  try {
    const input = join(dir, "in.glb");
    const output = join(dir, "weights.json");
    writeFileSync(input, await glb.writeBinary(doc));
    const t0 = Date.now();
    const out = await runBlender("auto_weights.py", { input, bones, output });
    for (const line of out.split(/\r?\n/))
      if (/auto_weights:|Bone Heat|failed/i.test(line))
        log(`  blender: ${line.trim()}`);
    log(`  blender: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const result = JSON.parse(readFileSync(output, "utf8"));
    const box = (get, count) => {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < count; i++)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], get(i, k));
          hi[k] = Math.max(hi[k], get(i, k));
        }
      return [lo, hi].map((v) => v.map((x) => +x.toFixed(4)));
    };
    log(`  ours    ${JSON.stringify(box((i, k) => P[i * 3 + k], n))}`);
    log(
      `  blender ${JSON.stringify(box((i, k) => result.vertices[i][k], result.vertices.length))}`,
    );
    if (process.env.KEEP_BLENDER_JSON)
      writeFileSync(process.env.KEEP_BLENDER_JSON, JSON.stringify(result));

    // Match Blender's vertices to ours: by index when Blender kept the
    // order (same count, every vertex where ours is), else the nearest
    // through a grid.
    const H = maxY - minY;
    const V = result.vertices;
    const gap = (i, k) =>
      Math.hypot(
        V[k][0] - P[i * 3],
        V[k][1] - P[i * 3 + 1],
        V[k][2] - P[i * 3 + 2],
      );
    let worstByIndex = Infinity;
    if (V.length === n) {
      worstByIndex = 0;
      for (let i = 0; i < n; i++)
        worstByIndex = Math.max(worstByIndex, gap(i, i));
    }
    const byIndex = worstByIndex < 1e-4 * H;
    log(
      `  matching ${byIndex ? "by index" : "by nearest"} (largest index offset ${Number.isFinite(worstByIndex) ? (worstByIndex / H).toExponential(1) : "n/a"} of the height)`,
    );
    const cell = H / 200;
    const grid = new Map();
    const cellKey = (x, y, z) =>
      `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    if (!byIndex)
      V.forEach((v, k) => {
        const c = cellKey(v[0], v[1], v[2]);
        const list = grid.get(c);
        if (list) list.push(k);
        else grid.set(c, [k]);
      });
    const nearest = (i) => {
      const [x, y, z] = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
      for (let r = 1; r < 50; r++) {
        let best = -1;
        let bd = Infinity;
        const [cx, cy, cz] = [x, y, z].map((t) => Math.floor(t / cell));
        for (let dx = -r; dx <= r; dx++)
          for (let dy = -r; dy <= r; dy++)
            for (let dz = -r; dz <= r; dz++)
              for (const k of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ??
                []) {
                const d = gap(i, k);
                if (d < bd) {
                  bd = d;
                  best = k;
                }
              }
        // Anything found within r cells is nearest once r cells cover it.
        if (best >= 0 && bd <= (r - 1) * cell) return [best, bd];
        if (best >= 0 && r > 2) return [best, bd];
      }
      return [-1, Infinity];
    };
    const jointOf = new Map(joints.map((j, i) => [j.getName(), i]));
    const J = new Uint16Array(n * 4);
    const W = new Float32Array(n * 4);
    let far = 0;
    let unweighted = 0;
    for (let i = 0; i < n; i++) {
      let b = i;
      if (!byIndex) {
        const [k, d] = nearest(i);
        b = k;
        if (d > 0.002 * H) far++;
      }
      const ws = V[b][3]
        .map(([g, w]) => [jointOf.get(result.names[g]), w])
        .filter(([j]) => j !== undefined);
      const sum = ws.reduce((s, [, w]) => s + w, 0);
      if (!ws.length || sum <= 0) {
        unweighted++;
        continue; // filled from its neighbours below
      }
      ws.forEach(([j, w], k) => {
        J[i * 4 + k] = j;
        W[i * 4 + k] = w / sum;
      });
    }
    log(
      `  ${far} vertices further than 0.2% of the height from Blender's, ${unweighted} without weights`,
    );
    if (far > 0.001 * n)
      throw new Error(`${far} vertices don't line up with Blender's copy`);
    if (unweighted)
      throw new Error(`${unweighted} vertices came back without weights`);
    prim.getAttribute("JOINTS_0").setArray(J).setNormalized(false);
    prim.getAttribute("WEIGHTS_0").setArray(W).setNormalized(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("usage: node scripts/blender-weights.mjs in.glb out.glb");
    process.exit(1);
  }
  const glb = await io();
  const doc = await glb.readBinary(new Uint8Array(readFileSync(input)));
  await blenderWeights(doc, glb);
  await doc.transform(
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  writeFileSync(output, await glb.writeBinary(doc));
  console.log(`wrote ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
