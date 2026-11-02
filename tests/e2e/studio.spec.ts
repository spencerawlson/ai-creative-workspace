import { expect, test } from "@playwright/test";
import { PRESETS, cloneLights } from "../../lib/lighting";
import { encodeSetup } from "../../lib/share";
import {
  canvasBrightness,
  isMobile,
  openStudio,
  sParam,
  showPanel,
} from "./helpers";

test.describe("Lighting Studio — critical journeys", () => {
  test("loads the scene with no errors and all six presets", async ({
    page,
  }) => {
    const errors = await openStudio(page);
    await showPanel(page, "presets");
    for (const p of PRESETS)
      await expect(page.getByTestId(`preset-${p.id}`)).toBeVisible();
    await expect(page.getByTestId("preset-three-point")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(errors).toEqual([]);
  });

  test("presets change the rendered image, the note and the URL", async ({
    page,
  }) => {
    await openStudio(page);
    await showPanel(page, "presets");
    const before = await sParam(page);
    await page.getByTestId("preset-low-key").click();
    await expect(page.getByTestId("preset-low-key")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => sParam(page)).not.toBe(before);
    const dark = await canvasBrightness(page);
    await page.getByTestId("preset-high-key").click();
    await expect.poll(() => canvasBrightness(page)).toBeGreaterThan(dark + 2);
  });

  test("a shared link reproduces the setup in a fresh browser", async ({
    page,
    browser,
  }) => {
    await openStudio(page);
    await showPanel(page, "presets");
    await page.getByTestId("preset-rembrandt").click();
    await showPanel(page, "scene");
    await page.getByTestId("node-model").click();
    await page.getByTestId("model-female").click();
    await expect(page.getByTestId("lighting-scene")).toHaveAttribute(
      "data-status",
      "ready",
    );
    const url = page.url();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("s"))
      .toBeTruthy();

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await openStudio(
      page2,
      new URL(page.url()).pathname + new URL(page.url()).search,
    );
    await showPanel(page2, "presets");
    await expect(page2.getByTestId("preset-rembrandt")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await showPanel(page2, "scene");
    await expect(page2.getByTestId("node-model")).toContainText("Female");
    await other.close();
    expect(url).toContain("s=");
  });

  test("M3 (v1) share links still open", async ({ page }) => {
    const rembrandt = PRESETS.find((p) => p.id === "rembrandt")!;
    await openStudio(
      page,
      `/?s=${encodeSetup("rembrandt", cloneLights(rembrandt.lights))}`,
      () => expect(page.getByTestId("notice")).toContainText("shared"),
    );
    await showPanel(page, "presets");
    await expect(page.getByTestId("preset-rembrandt")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a damaged link falls back to the default with a message", async ({
    page,
  }) => {
    await openStudio(page, "/?s=not-a-real-setup", () =>
      expect(page.getByTestId("notice")).toContainText("damaged"),
    );
    await showPanel(page, "presets");
    await expect(page.getByTestId("preset-three-point")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("undo and redo, with buttons and keyboard", async ({ page }, info) => {
    await openStudio(page);
    await showPanel(page, "presets");
    await page.getByTestId("preset-split").click();
    await page.getByTestId("preset-butterfly").click();
    await page.getByTestId("undo").click();
    await expect(page.getByTestId("preset-split")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("redo").click();
    await expect(page.getByTestId("preset-butterfly")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    test.skip(isMobile(info), "no hardware keyboard on phones");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("preset-split")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.getByTestId("preset-butterfly")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("4"); // Butterfly is preset 4; 1 = Three-point
    await page.keyboard.press("1");
    await expect(page.getByTestId("preset-three-point")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("add a softbox, edit it, delete it, undo the delete", async ({
    page,
  }) => {
    await openStudio(page);
    await showPanel(page, "scene");
    await page.getByTestId("add-light").click();
    await page.getByTestId("add-light-area").click();
    // The new light is selected and the inspector shows it.
    await expect(page.getByTestId("inspector")).toContainText("Softbox 4");
    const intensity = page.getByTestId("light-intensity");
    await intensity.fill("3");
    await expect(intensity).toHaveValue("3");
    await page.getByRole("button", { name: "Delete light" }).click();
    await showPanel(page, "scene");
    await expect(page.getByTestId("node-light-light-4")).toHaveCount(0);
    await page.getByTestId("undo").click();
    await expect(page.getByTestId("node-light-light-4")).toBeVisible();
  });

  test("switching mannequins loads each model and keeps the lights", async ({
    page,
  }) => {
    await openStudio(page);
    await showPanel(page, "presets");
    await page.getByTestId("preset-split").click();
    await showPanel(page, "scene");
    await page.getByTestId("node-model").click();
    for (const m of ["female", "male", "female"] as const) {
      await page.getByTestId(`model-${m}`).click();
      await expect(page.getByTestId("lighting-scene")).toHaveAttribute(
        "data-status",
        "ready",
      );
    }
    await showPanel(page, "presets");
    await expect(page.getByTestId("preset-split")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the session is autosaved and restored after a reload", async ({
    page,
  }) => {
    await openStudio(page);
    await showPanel(page, "presets");
    await page.getByTestId("preset-low-key").click();
    await page.getByTestId("project-name").fill("Moody test");
    await expect
      .poll(() =>
        page.evaluate(
          () => localStorage.getItem("acw.lighting.autosave.v2") ?? "",
        ),
      )
      .toContain("Moody test");
    await openStudio(page, "/"); // no ?s= → restore from autosave
    await expect(page.getByTestId("project-name")).toHaveValue("Moody test");
    await showPanel(page, "presets");
    await expect(page.getByTestId("preset-low-key")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("exports a PNG at the requested size", async ({ page }) => {
    await openStudio(page);
    await page.getByTestId("export-open").click();
    await page.getByLabel("1920 × 1080 (16:9)").check();
    const download = page.waitForEvent("download");
    await page.getByTestId("export-confirm").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/1920x1080\.png$/);
    const buf = await (
      await import("node:fs/promises")
    ).readFile((await file.path())!);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(1920);
    expect(buf.readUInt32BE(20)).toBe(1080);
    expect(buf.length).toBeGreaterThan(20_000); // a real render, not a blank frame
  });

  test("saves and re-opens a project file", async ({ page }, info) => {
    test.skip(isMobile(info), "project files are in the desktop toolbar");
    await openStudio(page);
    await showPanel(page, "presets");
    await page.getByTestId("preset-butterfly").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("save-project").click();
    const path = (await (await download).path())!;
    await page.getByTestId("preset-split").click();
    await page.getByTestId("open-file").setInputFiles(path);
    await expect(page.getByTestId("preset-butterfly")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Photography page still renders through the shared engine", async ({
    page,
  }) => {
    const errors = await openStudio(page, "/photography");
    await page.getByTestId("framing-closeup").click();
    await page.getByTestId("exposure-moody").click();
    await expect(page.getByTestId("thirds-overlay")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("layout", () => {
  test("no horizontal scroll and the viewport keeps a usable size", async ({
    page,
  }) => {
    await openStudio(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = (await page.getByTestId("lighting-scene").boundingBox())!;
    expect(box.width).toBeGreaterThan(320);
    expect(box.height).toBeGreaterThan(300);
  });

  test("selecting a light on a phone opens the inspector tab", async ({
    page,
  }, info) => {
    test.skip(!isMobile(info), "mobile layout only");
    await openStudio(page);
    await page.getByTestId("tab-scene").click();
    await page.getByTestId("node-light-key").click();
    await expect(page.getByTestId("tab-edit")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("light-azimuth")).toBeVisible();
  });
});
