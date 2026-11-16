import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  declineCookies,
  openStudio,
  showInspector,
  showPanel,
} from "./helpers";

/** Open the Sculpt page on a device with no sculptures kept yet. */
async function openSculpt(page: Page) {
  const errors: string[] = [];
  await declineCookies(page);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/sculpt");
  await page.evaluate(
    () =>
      new Promise((done) => {
        const q = indexedDB.deleteDatabase("iko3d-sculpts");
        q.onsuccess = q.onerror = q.onblocked = () => done(null);
      }),
  );
  await page.reload();
  await expect(page.getByTestId("sculpt-view")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 60_000 },
  );
  return errors;
}

/** Drag across the middle of the view (on the clay). */
async function stroke(page: Page, dy = 0) {
  const box = (await page.getByTestId("sculpt-view").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2 + dy;
  await page.mouse.move(x - 40, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y - 10, { steps: 10 });
  await page.mouse.up();
}

const steps = (page: Page) =>
  page.getByTestId("sculpt-view").getAttribute("data-steps");

test.describe("Sculpt", () => {
  test("sculpt with brushes, undo and redo, kept on the device, exported as STL", async ({
    page,
  }) => {
    const errors = await openSculpt(page);
    await expect(page.getByTestId("sculpt-name")).toHaveValue(
      "Sphere sculpture",
    );
    expect(await steps(page)).toBe("0");
    await expect(page.getByTestId("sculpt-undo")).toBeDisabled();

    // Each brush makes one undo step per stroke.
    for (const [i, brush] of ["draw", "clay", "smooth", "grab"].entries()) {
      await page.getByTestId(`brush-${brush}`).click();
      await expect(page.getByTestId("brush-note")).not.toBeEmpty();
      await stroke(page, i * 8 - 12);
      await expect.poll(() => steps(page)).toBe(String(i + 1));
    }
    await page.getByTestId("sculpt-undo").click();
    await expect.poll(() => steps(page)).toBe("3");
    await page.getByTestId("sculpt-redo").click();
    await expect.poll(() => steps(page)).toBe("4");

    // Turn view: a drag on the clay turns the view and sculpts nothing.
    await page.getByTestId("sculpt-turn-view").click();
    await stroke(page);
    expect(await steps(page)).toBe("4");
    await page.getByTestId("sculpt-turn-view").click();

    // Saved on the device; a reload opens it again.
    await page.getByTestId("sculpt-name").fill("Test head");
    await page.getByTestId("sculpt-name").blur();
    // Saved (not "Saving…", nor the not-yet-saved note).
    await expect(page.getByTestId("sculpt-status")).toHaveText(
      /^Saved on this device ·/,
      { timeout: 10_000 },
    );
    await page.reload();
    await expect(page.getByTestId("sculpt-view")).toHaveAttribute(
      "data-status",
      "ready",
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("sculpt-name")).toHaveValue("Test head");
    // In the menu bar: File > Open (on phones: Menu > Open).
    await page
      .locator("[data-testid=menu-file], [data-testid=menu-all]")
      .click();
    await page.getByTestId("sculpt-open").click();
    await expect(page.getByTestId("sculpt-open-dialog")).toContainText(
      "Test head",
    );
    await page.keyboard.press("Escape");

    // STL: binary, every triangle, at the height asked for.
    await page.getByTestId("sculpt-export").click();
    // This server doesn't offer Blender jobs (IKO_BLENDER unset): no
    // Blender option, and the job endpoint refuses.
    await expect(page.getByTestId("sculpt-export-format-glb")).toBeVisible();
    await expect(page.getByTestId("sculpt-export-format-blender")).toHaveCount(
      0,
    );
    const offered = await page.request.get("/api/blender");
    expect(await offered.json()).toMatchObject({ available: false });
    const job = await page.request.post("/api/blender/convert?format=fbx", {
      data: Buffer.from("glTF0000"),
    });
    expect(job.status()).toBe(404);
    await page.getByTestId("sculpt-export-height").fill("80");
    const download = page.waitForEvent("download");
    await page.getByTestId("sculpt-export-confirm").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("test-head.stl");
    const fs = await import("node:fs");
    const bytes = await fs.promises.readFile(await file.path());
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = v.getUint32(80, true);
    expect(count).toBe(81_920);
    expect(bytes.byteLength).toBe(84 + count * 50);
    let maxZ = 0;
    for (let t = 0; t < count; t += 7)
      for (let k = 1; k <= 3; k++)
        maxZ = Math.max(maxZ, v.getFloat32(84 + t * 50 + k * 12 + 8, true));
    expect(maxZ).toBeLessThanOrEqual(80.001);
    expect(maxZ).toBeGreaterThan(75);

    // A new sculpture from a block; the head stays kept.
    await page
      .locator("[data-testid=menu-file], [data-testid=menu-all]")
      .click();
    await page.getByTestId("sculpt-new").click();
    await page.getByTestId("sculpt-new-block").click();
    await expect(page.getByTestId("sculpt-name")).toHaveValue(
      "Rounded block sculpture",
    );
    expect(await steps(page)).toBe("0");
    expect(errors).toEqual([]);
  });

  test("a posed figure from the studio becomes clay on the Sculpt page", async ({
    page,
  }) => {
    test.slow(); // half a million triangles, drawn without a GPU
    await openSculpt(page); // a device with no sculptures yet
    await openStudio(page);
    await showPanel(page, "scene");
    await page.getByTestId("node-pose").click();
    await page.getByTestId("pose-preset-hand-on-hip").click();
    await showPanel(page, "scene");
    await page.getByTestId("node-figure-fig-1").click();
    await showInspector(page);
    await page.getByTestId("plinth-round").click();
    await page.getByTestId("statue-sculpt").click();
    await page.waitForURL(/\/sculpt$/, { timeout: 60_000 });
    await expect(page.getByTestId("sculpt-view")).toHaveAttribute(
      "data-status",
      "ready",
      { timeout: 120_000 },
    );
    await expect(page.getByTestId("sculpt-name")).toHaveValue(/· figure$/);
    // The whole figure and its plinth, welded: hundreds of thousands of
    // triangles, already kept on the device.
    const status = await page.getByTestId("sculpt-status").textContent();
    const triangles = Number(status!.replace(/[^0-9]/g, ""));
    expect(triangles).toBeGreaterThan(300_000);
    await page.getByTestId("brush-inflate").click();
    await stroke(page, -60);
    await expect.poll(() => steps(page), { timeout: 60_000 }).toBe("1");
  });

  test("the Sculpt page has no automatically detectable WCAG A/AA violations", async ({
    page,
  }) => {
    await openSculpt(page);
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      r.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      ),
    ).toEqual([]);
  });
});

test.describe("Sculpt with a pen", () => {
  /** A drag across the middle of the view, as `pointerType` events. */
  async function drag(page: Page, pointerType: "pen" | "touch", id: number) {
    await page.getByTestId("sculpt-canvas").evaluate(
      (el, { pointerType, id }) => {
        const r = el.getBoundingClientRect();
        const at = (dx: number) => ({
          pointerId: id,
          pointerType,
          isPrimary: true,
          button: 0,
          buttons: 1,
          pressure: 0.6,
          clientX: r.left + r.width / 2 + dx,
          clientY: r.top + r.height / 2,
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(new PointerEvent("pointerdown", at(-40)));
        for (let dx = -36; dx <= 40; dx += 4)
          el.dispatchEvent(new PointerEvent("pointermove", at(dx)));
        el.dispatchEvent(
          new PointerEvent("pointerup", { ...at(40), buttons: 0 }),
        );
      },
      { pointerType, id },
    );
  }

  test("the pen sculpts; after it, fingers only turn the view", async ({
    page,
  }) => {
    await openSculpt(page);
    // Before any pen: a finger on the clay sculpts (phones).
    await drag(page, "touch", 11);
    await expect.poll(() => steps(page)).toBe("1");
    await drag(page, "pen", 12);
    await expect.poll(() => steps(page)).toBe("2");
    // Now fingers navigate: no new step.
    await drag(page, "touch", 13);
    await page.waitForTimeout(300);
    expect(await steps(page)).toBe("2");
    await drag(page, "pen", 14);
    await expect.poll(() => steps(page)).toBe("3");
  });
});

test.describe("Sculpt: paint and mask", () => {
  test("paint, mask, whole-mask actions as undo steps; material and paint kept; colours in the GLB", async ({
    page,
  }) => {
    await openSculpt(page);
    await page.getByTestId("sculpt-material-plaster").click();

    await page.getByTestId("brush-paint").click();
    await expect(page.getByTestId("paint-options")).toBeVisible();
    await page.getByTestId("paint-swatch-c0392b").click();
    await stroke(page, -20);
    await expect.poll(() => steps(page)).toBe("1");

    await page.getByTestId("brush-mask").click();
    await expect(page.getByTestId("mask-options")).toBeVisible();
    await stroke(page, 20);
    await expect.poll(() => steps(page)).toBe("2");
    await page.getByTestId("mask-invert").click();
    await expect.poll(() => steps(page)).toBe("3");
    await page.getByTestId("mask-clear").click();
    await expect.poll(() => steps(page)).toBe("4");
    await page.getByTestId("sculpt-undo").click();
    await expect.poll(() => steps(page)).toBe("3");

    // Kept on the device: the material and the paint.
    await expect(page.getByTestId("sculpt-status")).toHaveText(
      /^Saved on this device ·/,
      { timeout: 10_000 },
    );
    await page.reload();
    await expect(page.getByTestId("sculpt-view")).toHaveAttribute(
      "data-status",
      "ready",
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("sculpt-material-plaster")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const fs = await import("node:fs");
    const { NodeIO } = await import("@gltf-transform/core");

    // Textured (the default, 1K here): unwrapped, the look baked into a
    // colour map; sampled at each vertex's UV, the paint is there.
    await page.getByTestId("sculpt-export").click();
    await page.getByTestId("sculpt-export-format-glb").click();
    await page.getByTestId("sculpt-export-maps-1024").click();
    const texturedDownload = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByTestId("sculpt-export-confirm").click();
    const texturedDoc = await new NodeIO().readBinary(
      new Uint8Array(
        await fs.promises.readFile(await (await texturedDownload).path()),
      ),
    );
    const tPrim = texturedDoc.getRoot().listMeshes()[0].listPrimitives()[0];
    const tMat = tPrim.getMaterial()!;
    expect(tMat.getMetallicRoughnessTexture()?.getSize()).toEqual([1024, 1024]);
    const map = tMat.getBaseColorTexture()!;
    expect(map.getSize()).toEqual([1024, 1024]);
    const uv = tPrim.getAttribute("TEXCOORD_0")!;
    const at: number[] = [];
    const p: number[] = [];
    for (let i = 0; i < uv.getCount(); i++) {
      uv.getElement(i, p);
      at.push(p[0], p[1]);
    }
    // The PNG decoded by the browser, read at those UVs.
    const samples = await page.evaluate(
      async ({ png, at }) => {
        const bin = Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0));
        const img = await createImageBitmap(
          new Blob([bin], { type: "image/png" }),
          { colorSpaceConversion: "none", premultiplyAlpha: "none" },
        );
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data;
        const out: number[][] = [];
        for (let i = 0; i < at.length; i += 2) {
          const x = Math.min(img.width - 1, Math.floor(at[i] * img.width));
          const y = Math.min(
            img.height - 1,
            Math.floor(at[i + 1] * img.height),
          );
          const o = (y * img.width + x) * 4;
          out.push([d[o], d[o + 1], d[o + 2]]);
        }
        return out;
      },
      { png: Buffer.from(map.getImage()!).toString("base64"), at },
    );
    let tRed = 0;
    let tPlain = 0;
    for (const [r, g, b] of samples) {
      if (r - g > 50 && r - b > 50) tRed++;
      else if (r > 200 && g > 200) tPlain++;
    }
    expect(tRed).toBeGreaterThan(10);
    expect(tPlain).toBeGreaterThan(1000);
    await expect(page.getByTestId("sculpt-status")).toHaveText(
      /Exported a GLB with 1024 × 1024 texture maps/,
    );

    // Without maps, the GLB carries the paint as vertex colours.
    await page.getByTestId("sculpt-export").click();
    await page.getByTestId("sculpt-export-format-glb").click();
    await page.getByTestId("sculpt-export-maps-0").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("sculpt-export-confirm").click();
    const bytes = new Uint8Array(
      await fs.promises.readFile(await (await download).path()),
    );
    const doc = await new NodeIO().readBinary(bytes);
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    const colors = prim.getAttribute("COLOR_0")!;
    expect(colors).toBeTruthy();
    // Somewhere it's red (the paint), somewhere the plaster's off-white.
    let red = 0;
    let plain = 0;
    const c: number[] = [];
    for (let i = 0; i < colors.getCount(); i++) {
      colors.getElement(i, c);
      // Paint mixes with the plaster by its coverage: redder, not pure.
      if (c[0] - c[1] > 0.2 && c[0] - c[2] > 0.2) red++;
      else if (c[0] > 0.8 && c[1] > 0.8) plain++;
    }
    expect(red).toBeGreaterThan(10);
    expect(plain).toBeGreaterThan(1000);
  });
});
