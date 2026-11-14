import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { sameScene } from "@/lib/studio/history";
import { StudioSession } from "@/mcp/session";
import { studioUrl } from "@/mcp/server";
import { callTool, listTools, type ToolContext } from "@/mcp/tools";

const ctx: ToolContext = { studioUrl: "http://studio.test", cast: [] };
const call = (s: StudioSession, name: string, args: unknown = {}) =>
  callTool(s, name, args, ctx);

describe("the MCP server's tools", () => {
  it("lists every tool with an object input schema, small enough to send", () => {
    const tools = listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "scene",
      "catalog",
      "find_motion",
      "act",
      "direct",
      "undo",
      "redo",
      "history",
      "share_link",
      "open_link",
    ]);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
    const act = JSON.stringify(
      tools.find((t) => t.name === "act")!.inputSchema,
    );
    expect(act).toContain('"applyMotion"');
    expect(act).not.toContain('"loadScene"');
    expect(act).not.toContain('"addSpeech"');
    expect(act.length).toBeLessThan(20_000);
  });

  it("acts all or nothing, as undo steps", async () => {
    const s = new StudioSession();
    const before = s.scene;
    const bad = await call(s, "act", {
      actions: [
        { type: "addFigure", model: "male" },
        { type: "updateFigure", figure: "fig-2", patch: { x: 1 } },
        { type: "updateFigure", figure: "fig-2", patch: { x: 10 } },
      ],
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Bad input: actions\.2\.patch\.x/);
    expect(s.scene).toBe(before);

    const refused = await call(s, "act", {
      actions: [
        { type: "addFigure" },
        { type: "removeLight", id: "no-such-light" },
      ],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/action 2 was refused \(No light/);
    expect(s.scene).toBe(before);

    await call(s, "act", { actions: [{ type: "addFigure", model: "male" }] });
    // A new figure stands on a free spot.
    const spot = s.scene.figures[1].x;
    await call(s, "undo");
    const ok = await call(s, "act", {
      actions: [
        { type: "addFigure", model: "male" },
        {
          type: "updateFigure",
          figure: "fig-2",
          patch: { x: 1, rotation: 90 },
        },
        { type: "applyPreset", presetId: "rembrandt" },
      ],
    });
    expect(ok.isError).toBeUndefined();
    expect(s.scene.figures).toHaveLength(2);
    expect(s.scene.figures[1]).toMatchObject({ x: 1, rotation: 90 });
    expect(ok.text).toContain("fig-2: male mannequin at x 1");
    expect(s.steps.labels).toHaveLength(4);

    // Already so: nothing changes, no undo step.
    const same = await call(s, "act", {
      actions: [{ type: "applyPreset", presetId: "rembrandt" }],
    });
    expect(same.text).toMatch(/^Nothing changed/);
    expect(s.steps.labels).toHaveLength(4);

    const undone = await call(s, "undo", { steps: 2 });
    expect(undone.text).toMatch(/^Undid: .+; .+\./);
    expect(s.scene.figures[1].x).toBe(spot);
    expect(s.scene.preset).not.toBe("rembrandt");
    await call(s, "redo");
    expect(s.scene.figures[1].x).toBe(1);
    expect((await call(s, "history")).text).toMatch(/→ 2\. Figure 2: move/);
    await call(s, "undo", { steps: 50 });
    expect(sameScene(s.scene, before)).toBe(true);
    expect((await call(s, "undo")).isError).toBe(true);
  });

  it("finds a move from words, as an action that works", async () => {
    const s = new StudioSession();
    const found = await call(s, "find_motion", { text: "wave", limit: 1 });
    const json = found.text.match(/\{"type":"applyMotion".*\}/)?.[0];
    expect(json).toBeTruthy();
    const r = await call(s, "act", { actions: [JSON.parse(json!)] });
    expect(r.isError).toBeUndefined();
    expect(s.scene.animation.keys.length).toBeGreaterThan(1);
    // How far a move goes, so figures can be placed to allow for it.
    const walk = (
      await call(s, "find_motion", { text: "walk 2 times", limit: 1 })
    ).text;
    expect(walk).toMatch(/Lasts [\d.]+ s and travels 2\.6 m forward/);
    expect(
      (await call(s, "find_motion", { text: "walk on the spot", limit: 1 }))
        .text,
    ).toMatch(/on the spot\./);
    expect((await call(s, "find_motion", { text: "qzxv" })).text).toMatch(
      /No move matches/,
    );
  });

  it("directs a figure in beats, and says what it couldn't read", async () => {
    const s = new StudioSession();
    const r = await call(s, "direct", {
      figure: "fig-1",
      script: "walk 2 times\nface the camera — warm\npause 1 s",
      from: 0.5,
    });
    expect(r.isError).toBeUndefined();
    expect(r.text).toMatch(/^Read as: .+ → .+ → .+\./);
    expect(s.scene.beats.map((b) => b.text)).toEqual([
      "walk 2 times",
      "face the camera",
      "pause 1 s",
    ]);
    expect(s.scene.beats[0].t).toBe(0.5);
    expect(s.scene.beats[1].note).toBe("warm");
    // The summary says where the walk leaves the figure.
    expect(r.text).toMatch(/animated: ends at x [\d.-]+, z -?[1-9]/);

    const before = s.scene;
    const said = await call(s, "direct", {
      figure: "fig-1",
      script: "wave\nsay hello",
    });
    expect(said.isError).toBe(true);
    expect(said.text).toMatch(
      /line 2 "say hello": speech needs a recorded sound/,
    );
    const garbled = await call(s, "direct", {
      figure: "fig-1",
      script: "wave\nflibbertigibbet the moon",
    });
    expect(garbled.text).toMatch(/line 2/);
    expect(
      (await call(s, "direct", { figure: "fig-9", script: "wave" })).text,
    ).toMatch(/refused/);
    expect(s.scene).toBe(before);
  });

  it("shares the scene as a studio link, and opens one", async () => {
    const s = new StudioSession();
    await call(s, "direct", { figure: "fig-1", script: "wave; pause 1 s" });
    const link = (await call(s, "share_link")).text;
    expect(link).toMatch(/^http:\/\/studio\.test\/studio\?s=z[\w-]+$/);

    const other = new StudioSession();
    const opened = await call(other, "open_link", { link });
    expect(opened.isError).toBeUndefined();
    expect(other.scene.beats.map((b) => b.text)).toEqual(["wave", "pause 1 s"]);
    expect(other.scene.animation.keys).toHaveLength(
      s.scene.animation.keys.length,
    );
    expect(other.steps.labels.at(-1)).toBe("Open shared scene");

    const param = new URL(link).searchParams.get("s")!;
    expect(
      (await call(new StudioSession(), "open_link", { link: param })).isError,
    ).toBeUndefined();
    for (const bad of ["https://example.com/studio", "zzzz", "not a link"])
      expect((await call(other, "open_link", { link: bad })).isError).toBe(
        true,
      );
  });

  it("lists catalogues and reads the scene", async () => {
    const s = new StudioSession();
    const joints = (await call(s, "catalog", { list: "joints" })).text;
    expect(joints).toMatch(/- elbowL \(Left elbow\): bend 0\.\.145/);
    expect((await call(s, "catalog", { list: "motions" })).text).toMatch(
      /Gestures: /,
    );
    expect((await call(s, "catalog", { list: "characters" })).text).toMatch(
      /cast is empty/,
    );
    const withCast = await callTool(
      s,
      "catalog",
      { list: "characters" },
      {
        ...ctx,
        cast: [
          {
            id: "cast-dancer",
            name: "Dancer",
            file: "dancer.glb",
            size: 1,
            credit: { tool: "Meshy", prompt: "a dancer" },
          },
        ],
      },
    );
    expect(withCast.text).toContain('- cast-dancer: Dancer ("a dancer")');
    expect((await call(s, "scene")).text).toMatch(/^Figures \(1 of 4\):/);
    expect(
      JSON.parse((await call(s, "scene", { json: true })).text).version,
    ).toBe(2);
    expect((await call(s, "catalog", { list: "nope" })).isError).toBe(true);
    expect((await call(s, "nope")).isError).toBe(true);
  });

  it("points links at IKO_STUDIO_URL, http(s) only", () => {
    expect(studioUrl({})).toBe("http://localhost:3000");
    expect(studioUrl({ IKO_STUDIO_URL: "http://192.168.1.46:3000/" })).toBe(
      "http://192.168.1.46:3000",
    );
    expect(() => studioUrl({ IKO_STUDIO_URL: "file:///etc" })).toThrow();
  });
});

describe("the MCP server over stdio", () => {
  it("starts from any folder and answers an MCP client", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), "mcp", "start.mjs")],
      cwd: tmpdir(),
      env: { ...process.env, IKO_STUDIO_URL: "http://studio.test" } as Record<
        string,
        string
      >,
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    try {
      expect(client.getInstructions()).toMatch(/share_link/);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(10);
      const r = await client.callTool({
        name: "act",
        arguments: { actions: [{ type: "addFigure", model: "female" }] },
      });
      expect(r.isError).toBeFalsy();
      const text = (r.content as Array<{ text: string }>)[0].text;
      expect(text).toMatch(/Figures \(2 of 4\)/);
      const bad = await client.callTool({ name: "act", arguments: {} });
      expect(bad.isError).toBe(true);
      const link = await client.callTool({ name: "share_link", arguments: {} });
      expect((link.content as Array<{ text: string }>)[0].text).toMatch(
        /^http:\/\/studio\.test\/studio\?s=/,
      );
    } finally {
      await client.close();
    }
  }, 60_000);
});
