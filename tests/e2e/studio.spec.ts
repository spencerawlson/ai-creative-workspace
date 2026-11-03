import { expect, test } from "@playwright/test";
import { PRESETS, cloneLights } from "../../lib/lighting";
import { encodeSetup } from "../../lib/share";
import {
  canvasBrightness,
  dragOnPage,
  isMobile,
  jointsOnScreen,
  onCanvas,
  overlayPixels,
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
    await page.getByTestId("node-figure-fig-1").click();
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
    await expect(page2.getByTestId("node-figure-fig-1")).toContainText(
      "Female",
    );
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
    await page.getByTestId("node-figure-fig-1").click();
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
    expect(await overlayPixels(page)).toBe(0);
    await page.getByTestId("node-pose").click();
    // Pose mode draws the joint overlay.
    await expect.poll(() => overlayPixels(page)).toBeGreaterThan(20);
    const joints = await jointsOnScreen(page);
    expect(joints).toHaveProperty("handR");
    expect(joints).toHaveProperty("wristL");
    // Use a hand that isn't under a side panel (on a tablet the figure's
    // right hand sits behind the scene list).
    const exposed = (p: { x: number; y: number }) =>
      page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName === "CANVAS",
        p,
      );
    const side = (await exposed(joints.handR)) ? "R" : "L";
    expect(await exposed(joints[`hand${side}`])).toBe(true);
    const wrist = joints[`wrist${side}`];
    const hand = joints[`hand${side}`];
    const out = side === "R" ? -40 : 40; // away from the body on screen
    const box = (await page.getByTestId("lighting-scene").boundingBox())!;

    // Grab the hand and pull it up: the whole arm follows.
    await dragOnPage(page, info, hand, {
      x: hand.x,
      y: hand.y - box.height * 0.35,
    });
    await expect(page.getByTestId(`pose-group-arm${side}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const raise = page.getByTestId(`pose-shoulder${side}-raise`);
    await expect
      .poll(async () => Number(await raise.inputValue()))
      .toBeGreaterThan(30);
    // The whole drag is one undo step.
    await page.getByTestId("undo").click();
    await expect(raise).toHaveValue("0");

    // Drag the wrist's own dot outwards: the hand bends at the wrist.
    await dragOnPage(page, info, wrist, { x: wrist.x + out, y: wrist.y - 10 });
    const bend = page.getByTestId(`pose-wrist${side}-bend`);
    const lift = page.getByTestId(`pose-wrist${side}-lift`);
    await expect
      .poll(
        async () =>
          Math.abs(Number(await bend.inputValue())) +
          Math.abs(Number(await lift.inputValue())),
      )
      .toBeGreaterThan(10);
    await expect(raise).toHaveValue("0");
  });

  test("several figures: add, turn, move, pose each one, share", async ({
    page,
    browser,
  }, info) => {
    await openStudio(page);
    await showPanel(page, "scene");
    await page.getByTestId("add-figure").click();
    const second = page.getByTestId("node-figure-fig-2");
    // The new figure's controls open (on a phone, in the Inspect tab).
    await expect(page.getByTestId("model-male")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("model-female").click();
    await expect(page.getByTestId("lighting-scene")).toHaveAttribute(
      "data-status",
      "ready",
      { timeout: 90_000 },
    );
    const turn = page.getByTestId("figure-rotation");
    await turn.fill("-30");
    await expect(turn).toHaveValue("-30");
    await showPanel(page, "scene");
    await expect(second).toContainText("Female");
    await expect(page.getByTestId("node-figure-fig-1")).toContainText("Male");
    await second.click();

    // Drag a figure across the floor (whichever isn't under a panel).
    const x = page.getByTestId("figure-x");
    for (const id of ["fig-2", "fig-1"]) {
      const body = (await jointsOnScreen(page, id)).body;
      if (!body || !(await onCanvas(page, body))) continue;
      if (id === "fig-1") {
        await showPanel(page, "scene");
        await page.getByTestId("node-figure-fig-1").click();
      }
      const before = Number(await x.inputValue());
      await dragOnPage(page, info, body, { x: body.x + 40, y: body.y });
      await expect
        .poll(async () => Number(await x.inputValue()))
        .toBeGreaterThan(before + 0.05);
      // One undo puts it back.
      await page.getByTestId("undo").click();
      await expect
        .poll(async () => Number(await x.inputValue()))
        .toBeCloseTo(before, 2);
      break;
    }

    // Pose figure 2 only.
    await showPanel(page, "scene");
    await second.click();
    await showPanel(page, "scene");
    await page.getByTestId("node-pose").click();
    const beforePose = await sParam(page);
    await page.getByTestId("pose-preset-arms-up").click();
    await showPanel(page, "scene");
    await expect(second).toContainText("Arms up");
    await expect(page.getByTestId("node-figure-fig-1")).toContainText(
      "Scan A-pose",
    );

    // A share link carries both figures (the link updates after a short
    // debounce: wait for the one that includes the pose).
    await expect.poll(() => sParam(page)).not.toBe(beforePose);
    const url = new URL(page.url());
    const other = await browser.newContext();
    const page2 = await other.newPage();
    await openStudio(page2, url.pathname + url.search);
    await showPanel(page2, "scene");
    await expect(page2.getByTestId("node-figure-fig-2")).toContainText(
      "Female · Arms up",
    );
    await other.close();

    // Remove it again; the last figure can't be removed.
    await showPanel(page, "scene");
    await second.click();
    await page.getByTestId("figure-remove").click();
    await expect(second).toHaveCount(0);
    await showPanel(page, "scene");
    await page.getByTestId("node-figure-fig-1").click();
    await expect(page.getByTestId("figure-remove")).toBeDisabled();
  });

  test("keyframes: auto-key, scrub, undo, play, preview, graph editor", async ({
    page,
  }, info) => {
    await openStudio(page);
    const scrub = page.getByTestId("timeline-scrub");
    await page.getByTestId("timeline-autokey").click();
    await showPanel(page, "scene");
    await page.getByTestId("node-pose").click();
    await page.getByTestId("pose-group-armR").click();
    await page.getByTestId("pose-preset-neutral").click();
    await expect(page.getByTestId("timeline-key-0.00")).toBeVisible();

    // Auto-key: an edit at 2 s keys 2 s.
    await scrub.fill("2");
    const raise = page.getByTestId("pose-shoulderR-raise");
    await raise.fill("120");
    await expect(page.getByTestId("timeline-key-2.00")).toBeVisible();

    // Between keys the pose is interpolated (eased: halfway is halfway).
    await scrub.fill("1");
    await expect(raise).toHaveValue("60");

    // The edit and its key were one undo step.
    await page.getByTestId("undo").click();
    await expect(page.getByTestId("timeline-key-2.00")).toHaveCount(0);
    await page.getByTestId("redo").click();
    await expect(page.getByTestId("timeline-key-2.00")).toBeVisible();

    // Play moves the time.
    const clock = page.getByTestId("timeline-time");
    const before = await clock.innerText();
    await page.getByTestId("timeline-play").click();
    await expect.poll(() => clock.innerText()).not.toBe(before);
    await page.getByTestId("timeline-play").click();

    // Preview screen: full window, Esc closes it.
    await page.getByTestId("timeline-preview").click();
    await expect(page.getByTestId("preview-screen")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("preview-screen")).toHaveCount(0);

    // Graph editor: drag the 2 s point down to lower that key's value.
    await page.getByTestId("timeline-graph").click();
    await expect(page.getByTestId("graph-editor")).toBeVisible();
    const point = page.getByTestId("graph-key-fig-1.shoulderR.raise@2.00");
    const b = (await point.boundingBox())!;
    const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await dragOnPage(page, info, from, { x: from.x, y: from.y + 40 });
    await scrub.fill("2");
    await expect
      .poll(async () => Number(await raise.inputValue()))
      .toBeLessThan(110);
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
