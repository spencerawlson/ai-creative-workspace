import { expect, test } from "@playwright/test";
import { PRESETS, cloneLights } from "../../lib/lighting";
import { encodeSetup } from "../../lib/share";
import {
  canvasBrightness,
  dragOnPage,
  isMobile,
  jointRings,
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
    // The URL is synced on a 400 ms debounce: wait for each edit to land
    // in it before copying the link, or a fast machine copies a stale one.
    const initial = await sParam(page);
    await page.getByTestId("preset-rembrandt").click();
    await expect.poll(() => sParam(page)).not.toBe(initial);
    const afterPreset = await sParam(page);
    await showPanel(page, "scene");
    await page.getByTestId("node-model").click();
    await page.getByTestId("model-female").click();
    await expect(page.getByTestId("lighting-scene")).toHaveAttribute(
      "data-status",
      "ready",
    );
    await expect.poll(() => sParam(page)).not.toBe(afterPreset);
    const url = new URL(page.url());

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await openStudio(page2, url.pathname + url.search);
    await showPanel(page2, "presets");
    await expect(page2.getByTestId("preset-rembrandt")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await showPanel(page2, "scene");
    await expect(page2.getByTestId("node-model")).toContainText("Female");
    await other.close();
  });

  test("M3 (v1) share links still open", async ({ page }) => {
    const rembrandt = PRESETS.find((p) => p.id === "rembrandt")!;
    await openStudio(
      page,
      `/?s=${encodeSetup("rembrandt", cloneLights(rembrandt.lights))}`,
    );
    // The link is upgraded in place to a v2 link ({"v":2,... in base64).
    await expect
      .poll(() => new URL(page.url()).searchParams.get("s"))
      .toMatch(/^eyJ2Ijoy/);
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

  test("pose the mannequin: preset, joint slider, undo, share link", async ({
    page,
    browser,
  }) => {
    await openStudio(page);
    await showPanel(page, "scene");
    await page.getByTestId("node-pose").click();
    const viewport = page.getByTestId("lighting-scene");
    const before = await viewport.screenshot();
    await page.getByTestId("pose-preset-hand-raised").click();
    await expect(page.getByTestId("pose-preset-hand-raised")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The figure really moved.
    await expect
      .poll(async () => Buffer.compare(before, await viewport.screenshot()))
      .not.toBe(0);

    // The pose travels in the share link.
    await expect.poll(() => sParam(page)).toMatch(/./);
    const url = new URL(page.url());
    const other = await browser.newContext();
    const page2 = await other.newPage();
    await openStudio(page2, url.pathname + url.search);
    await showPanel(page2, "scene");
    await expect(page2.getByTestId("node-pose")).toContainText("Hand raised");
    await other.close();

    // Lift the hand at the wrist, then undo it.
    await page.getByTestId("pose-group-armR").click();
    const lift = page.getByTestId("pose-wristR-lift");
    await lift.fill("40");
    await expect(lift).toHaveValue("40");
    await page.getByTestId("undo").click();
    await expect(lift).toHaveValue("15");
  });

  test("drag the figure to pose it: hand lifts the arm, wrist dot bends the hand", async ({
    page,
  }, info) => {
    await openStudio(page);
    await showPanel(page, "scene");
    await page.getByTestId("node-pose").click();
    // Pose mode shows a circle on every posable joint.
    let rings: Array<{ x: number; y: number }> = [];
    await expect
      .poll(async () => (rings = await jointRings(page)).length)
      .toBeGreaterThanOrEqual(10);
    // The figure faces the camera: its right wrist is the left-most
    // joint, and its right elbow the nearest joint above that.
    const wrist = rings.reduce((a, r) => (r.x < a.x ? r : a));
    const elbow = rings
      .filter((r) => r.y < wrist.y - 5)
      .reduce((a, r) =>
        Math.hypot(r.x - wrist.x, r.y - wrist.y) <
        Math.hypot(a.x - wrist.x, a.y - wrist.y)
          ? r
          : a,
      );
    const hand = {
      x: wrist.x + (wrist.x - elbow.x) * 0.45,
      y: wrist.y + (wrist.y - elbow.y) * 0.45,
    };
    const box = (await page.getByTestId("lighting-scene").boundingBox())!;

    // Grab the hand and pull it up: the whole arm follows.
    await dragOnPage(page, info, hand, {
      x: hand.x,
      y: hand.y - box.height * 0.35,
    });
    await expect(page.getByTestId("pose-group-armR")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const raise = page.getByTestId("pose-shoulderR-raise");
    await expect
      .poll(async () => Number(await raise.inputValue()))
      .toBeGreaterThan(30);
    // The whole drag is one undo step.
    await page.getByTestId("undo").click();
    await expect(raise).toHaveValue("0");

    // Drag the wrist's own dot outwards: the hand bends at the wrist.
    await dragOnPage(page, info, wrist, { x: wrist.x - 40, y: wrist.y - 10 });
    const bend = page.getByTestId("pose-wristR-bend");
    const lift = page.getByTestId("pose-wristR-lift");
    await expect
      .poll(
        async () =>
          Math.abs(Number(await bend.inputValue())) +
          Math.abs(Number(await lift.inputValue())),
      )
      .toBeGreaterThan(10);
    await expect(raise).toHaveValue("0");
  });

  test("tapping the figure opens the pose controls for that body part", async ({
    page,
  }) => {
    await openStudio(page);
    // The full-body view is centred on the hips.
    await page.getByTestId("lighting-scene").click();
    await expect(page.getByTestId("pose-group-torso")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("pose-spine-bend")).toBeVisible();
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
