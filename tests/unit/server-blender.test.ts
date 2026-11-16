import { describe, expect, it } from "vitest";
import {
  JobError,
  MAX_UPLOAD,
  blenderOffered,
  isJob,
  runJob,
} from "@/lib/server/blender";

const glbHeader = () => {
  const b = new Uint8Array(20);
  b.set([0x67, 0x6c, 0x54, 0x46]); // "glTF"
  return b;
};

async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(JobError);
    return { status: (e as JobError).status, message: (e as Error).message };
  }
  throw new Error("expected a refusal");
}

describe("the app server's Blender jobs", () => {
  it("are off unless the server opts in", () => {
    expect(blenderOffered({})).toBe(false);
    expect(blenderOffered({ IKO_BLENDER: "0" })).toBe(false);
  });

  it("know only their own jobs", () => {
    expect(isJob("convert")).toBe(true);
    expect(isJob("retopo")).toBe(true);
    expect(isJob("render")).toBe(true);
    expect(isJob("exec")).toBe(false);
    expect(isJob("__proto__")).toBe(false);
  });

  it("refuse what isn't a GLB, before Blender starts", async () => {
    const r = await refusal(
      runJob("convert", new TextEncoder().encode("hello world!"), {
        format: "fbx",
      }),
    );
    expect(r.status).toBe(400);
  });

  it("refuse bad settings", async () => {
    expect(
      (await refusal(runJob("convert", glbHeader(), { format: "obj" }))).status,
    ).toBe(400);
    expect(
      (await refusal(runJob("retopo", glbHeader(), { faces: "5" }))).status,
    ).toBe(400);
    expect(
      (await refusal(runJob("retopo", glbHeader(), { faces: "abc" }))).status,
    ).toBe(400);
    expect(
      (await refusal(runJob("render", glbHeader(), { engine: "unreal" })))
        .status,
    ).toBe(400);
  });

  it("refuse a model over the size limit", async () => {
    const big = new Uint8Array(MAX_UPLOAD + 1);
    big.set(glbHeader());
    expect(
      (await refusal(runJob("convert", big, { format: "fbx" }))).status,
    ).toBe(413);
  });
});
