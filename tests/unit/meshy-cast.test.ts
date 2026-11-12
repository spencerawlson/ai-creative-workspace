import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { createMeshy } from "@/scripts/meshy/client.mjs";
import {
  CREDITS,
  estimate,
  makeCast,
  manifest,
  readSpec,
} from "@/scripts/meshy/cast.mjs";
import { optimizeCast } from "@/scripts/meshy/optimize-cast.mjs";

const KEY = "msy_test_secret_key_123";

/** The pipeline's saved state: loosely typed JSON, as on disk. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = Record<string, any>;

/** A pretend Meshy: tasks go PENDING → IN_PROGRESS → (SUCCEEDED or what
 * `fail` says), one step per look. Records every request. */
function fakeMeshy(fail: Record<string, string> = {}) {
  const requests: Array<{
    method: string;
    url: string;
    auth: string | null;
    body?: Record<string, unknown>;
  }> = [];
  const tasks = new Map<string, { kind: string; looks: number }>();
  let n = 0;
  const json = (data: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", ...headers },
    });
  const fetch = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const auth =
      (init.headers as Record<string, string> | undefined)?.Authorization ??
      null;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, url, auth, body });
    if (url.startsWith("https://assets.meshy.ai/"))
      return new Response(new Uint8Array([1, 2, 3, 4]));
    if (auth !== `Bearer ${KEY}`) return new Response("{}", { status: 401 });
    const path = new URL(url).pathname;
    if (method === "POST") {
      const kind = path.includes("rigging")
        ? "rig"
        : body.mode === "refine"
          ? "refine"
          : "preview";
      const id = `${kind}-${++n}`;
      tasks.set(id, { kind, looks: 0 });
      return json({ result: id });
    }
    const id = path.split("/").pop()!;
    const t = tasks.get(id)!;
    t.looks++;
    const status =
      t.looks === 1
        ? "PENDING"
        : t.looks === 2
          ? "IN_PROGRESS"
          : (fail[t.kind] ?? "SUCCEEDED");
    return json(
      {
        id,
        status,
        progress: t.looks * 40,
        ...(status === "FAILED"
          ? { task_error: { message: "the model melted" }, consumed_credits: 0 }
          : {}),
        ...(status === "SUCCEEDED"
          ? {
              consumed_credits: CREDITS[t.kind as keyof typeof CREDITS],
              ...(t.kind === "rig"
                ? {
                    result: {
                      rigged_character_glb_url: `https://assets.meshy.ai/${id}.glb?Expires=1&Signature=x`,
                    },
                  }
                : {}),
            }
          : {}),
      },
      t.looks === 1 ? { "Retry-After": "2" } : {},
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

const cast = readSpec({
  version: 1,
  cast: [
    { id: "dancer", name: "Dancer", prompt: "a dancer", heightMeters: 1.65 },
  ],
});

function run(
  meshy: ReturnType<typeof fakeMeshy>,
  state: State,
  log: string[] = [],
  slept: number[] = [],
) {
  const saved: string[] = [];
  return makeCast({
    cast,
    state,
    meshy: createMeshy({
      key: KEY,
      fetch: meshy.fetch,
      sleep: async (ms) => void slept.push(ms),
      log: (l) => log.push(l),
    }),
    saveState: async (s) => void saved.push(JSON.stringify(s)),
    writeSource: async (id, bytes) => {
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
      return `assets/cast/source/${id}.glb`;
    },
    log: (l) => log.push(l),
  }).then((r) => ({ ...r, saved }));
}

describe("the Meshy cast pipeline", () => {
  it("drafts, textures and rigs a character, then downloads it", async () => {
    const meshy = fakeMeshy();
    const state: State = {};
    const log: string[] = [];
    const slept: number[] = [];
    const r = await run(meshy, state, log, slept);
    expect(r).toMatchObject({ made: ["dancer"], failed: [] });
    const posts = meshy.requests.filter((q) => q.method === "POST");
    expect(posts.map((q) => new URL(q.url).pathname)).toEqual([
      "/openapi/v2/text-to-3d",
      "/openapi/v2/text-to-3d",
      "/openapi/v1/rigging",
    ]);
    expect(posts[0].body).toMatchObject({
      mode: "preview",
      prompt: "a dancer",
      pose_mode: "a-pose",
      target_formats: ["glb"],
    });
    expect(posts[1].body).toMatchObject({
      mode: "refine",
      preview_task_id: "preview-1",
      enable_pbr: true,
    });
    expect(posts[2].body).toMatchObject({
      input_task_id: "refine-2",
      height_meters: 1.65,
      skeleton_template: "mixamo",
      include_fingers: true,
    });
    // The key goes to Meshy's API only, never to the download host.
    for (const q of meshy.requests)
      expect(q.auth).toBe(
        q.url.startsWith("https://api.meshy.ai/") ? `Bearer ${KEY}` : null,
      );
    // Waits what Retry-After says, else 5 s.
    expect(slept).toEqual([2000, 5000, 2000, 5000, 2000, 5000]);
    expect(state.dancer).toMatchObject({
      file: "assets/cast/source/dancer.glb",
      credits: 35,
      preview: "preview-1",
      refine: "refine-2",
      rig: "rig-3",
    });
    // The task id is saved before waiting on it.
    expect(JSON.parse(r.saved[1]).dancer.preview).toBe("preview-1");
    expect(log.join("\n")).not.toContain(KEY);
  });

  it("picks up where it stopped, without paying for a step twice", async () => {
    const meshy = fakeMeshy();
    // The draft finished; the texture task was created, then the run
    // stopped (a closed laptop).
    const state: State = {
      dancer: {
        prompt: "a dancer",
        credits: 20,
        preview: "preview-old",
        previewDone: true,
        refine: "refine-0",
      },
    };
    // The fake knows the texture task as one in progress.
    await meshy.fetch("https://api.meshy.ai/openapi/v2/text-to-3d", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ mode: "refine" }),
    });
    state.dancer.refine = "refine-1";
    meshy.requests.length = 0;
    await run(meshy, state);
    const posts = meshy.requests.filter((q) => q.method === "POST");
    expect(posts.map((q) => new URL(q.url).pathname)).toEqual([
      "/openapi/v1/rigging",
    ]);
    expect(state.dancer).toMatchObject({
      credits: 35,
      file: expect.any(String),
    });
    expect(estimate(cast, state).total).toBe(0);
  });

  it("a failed task is refunded and made afresh next time", async () => {
    const state: State = {};
    const first = await run(fakeMeshy({ refine: "FAILED" }), state);
    expect(first.failed[0].error).toContain("the model melted");
    // The draft is kept (paid for); the failed texture task is dropped.
    expect(state.dancer).toMatchObject({ preview: "preview-1", credits: 20 });
    expect(state.dancer.refine).toBeUndefined();
    expect(estimate(cast, state).total).toBe(CREDITS.refine + CREDITS.rig);
    const again = fakeMeshy();
    const second = await run(again, state);
    expect(second.made).toEqual(["dancer"]);
    expect(
      again.requests
        .filter((q) => q.method === "POST")
        .map((q) => (q.body as { mode?: string }).mode ?? "rig"),
    ).toEqual(["refine", "rig"]);
  });

  it("a changed description starts that character over", async () => {
    const state: State = {
      dancer: { prompt: "an old description", credits: 35, file: "x.glb" },
    };
    expect(estimate(cast, state).total).toBe(35);
    const meshy = fakeMeshy();
    await run(meshy, state);
    expect(meshy.requests.filter((q) => q.method === "POST")).toHaveLength(3);
    expect(state.dancer.prompt).toBe("a dancer");
  });

  it("explains Meshy's refusals without ever showing the key", async () => {
    const meshy = createMeshy({
      key: KEY,
      fetch: (async () =>
        new Response(JSON.stringify({ message: "Insufficient funds" }), {
          status: 402,
        })) as unknown as typeof fetch,
    });
    const e = await meshy.create("textTo3d", {}).catch((x: Error) => x);
    expect(String(e)).toMatch(/paid Meshy plan.*Insufficient funds/);
    expect(String(e)).not.toContain(KEY);
    expect(() => createMeshy({ key: "" })).toThrow(/MESHY_API_KEY/);
  });

  it("checks the spec, and lists only finished characters for the app", () => {
    expect(() => readSpec({ version: 1, cast: [{ id: "Bad Id" }] })).toThrow(
      /id/,
    );
    expect(() =>
      readSpec({
        version: 1,
        cast: [
          { id: "a1", name: "A", prompt: "p" },
          { id: "a1", name: "B", prompt: "q" },
        ],
      }),
    ).toThrow(/twice/);
    const state = {
      dancer: { prompt: "a dancer", file: "x", madeAt: "2026-11-18" },
    };
    expect(manifest(cast, state, {})).toEqual({ version: 1, cast: [] });
    expect(manifest(cast, state, { dancer: 4_200_000 })).toEqual({
      version: 1,
      cast: [
        {
          id: "cast-dancer",
          name: "Dancer",
          file: "dancer.glb",
          size: 4_200_000,
          credit: { tool: "Meshy", prompt: "a dancer", made: "2026-11-18" },
        },
      ],
    });
  });
});

describe("slimming a cast member for the app", () => {
  const io = async () => {
    await MeshoptDecoder.ready;
    return new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  };

  it("keeps the skeleton, shrinks textures to 1024 px WebP", async () => {
    // The test character, given a 2048 px base colour texture, as a
    // Meshy download has.
    const doc = await (
      await io()
    ).readBinary(readFileSync("tests/fixtures/test-character.glb"));
    // Noise, not one colour: a single-colour texture would be folded
    // into a plain colour.
    const pixels = new Uint8Array(2048 * 2048 * 3).map(
      (_, i) => (i * 2654435761) % 251,
    );
    const png = await sharp(pixels, {
      raw: { width: 2048, height: 2048, channels: 3 },
    })
      .png()
      .toBuffer();
    const tex = doc
      .createTexture("base")
      .setImage(new Uint8Array(png))
      .setMimeType("image/png");
    const skin = doc.createMaterial("Skin").setBaseColorTexture(tex);
    for (const mesh of doc.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives()) prim.setMaterial(skin);
    const input = await (await io()).writeBinary(doc);

    const r = await optimizeCast(input);
    const out = await (await io()).readBinary(r.bytes);
    const [t] = out.getRoot().listTextures();
    expect(t.getMimeType()).toBe("image/webp");
    expect(Math.max(...t.getSize()!)).toBeLessThanOrEqual(1024);
    expect(r.info.joints).toContain("mixamorig:Hips");
    expect(r.info.joints.length).toBe(r.before.joints.length);
    expect(r.info.triangles).toBe(r.before.triangles);
  }, 60_000);

  it("refuses a model without a skeleton", async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    const pos = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buf);
    const mesh = doc
      .createMesh()
      .addPrimitive(doc.createPrimitive().setAttribute("POSITION", pos));
    doc.createScene().addChild(doc.createNode().setMesh(mesh));
    const bytes = await new NodeIO().writeBinary(doc);
    await expect(optimizeCast(bytes)).rejects.toThrow(/no skeleton/);
  });
});
