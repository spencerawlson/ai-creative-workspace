import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { jointsOnScreen } from "./helpers";

type Workspace = "studio" | "sculpt" | "photography";
const LABEL: Record<Workspace, string> = {
  studio: "Studio",
  sculpt: "Sculpt",
  // "Photo" in the sidebar, "Photography" in tabs and the menu.
  photography: "Photo",
};

/** Go to a workspace the way this screen offers: the sidebar or tabs
 * when they're shown, else the workspace menu. */
async function go(page: Page, to: Workspace) {
  const direct = page.getByTestId(`nav-${to}`);
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByTestId("nav-menu").click();
    await expect(page.getByTestId("nav-menu-list")).toBeVisible();
    await page.getByTestId(`nav-menu-${to}`).click();
  }
  await page.waitForURL(new RegExp(`/${to}$`));
}

/** The workspace marked as the current one. */
async function expectCurrent(page: Page, ws: Workspace) {
  const direct = page.getByTestId(`nav-${ws}`);
  if (await direct.isVisible())
    await expect(direct).toHaveAttribute("aria-current", "page");
  else await expect(page.getByTestId("nav-menu")).toContainText(LABEL[ws]);
}

test.describe("Workspaces", () => {
  test("switch between Studio, Sculpt and Photography from any of them", async ({
    page,
  }) => {
    await page.goto("/sculpt");
    await expectCurrent(page, "sculpt");
    await go(page, "photography");
    await expectCurrent(page, "photography");
    await go(page, "studio");
    await expectCurrent(page, "studio");
    await go(page, "sculpt");
    await expectCurrent(page, "sculpt");
    await page.getByTestId("nav-home").click();
    await page.waitForURL(/\/$/);
  });

  test("on a wide screen the studio's sidebar holds the workspaces, then its tools", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile", "phones have no sidebar");
    await page.goto("/studio");
    for (const ws of ["studio", "sculpt", "photography"] as const)
      await expect(page.getByTestId(`nav-${ws}`)).toContainText(LABEL[ws]);
    await expect(page.getByTestId("tool-scene")).toContainText("Scene");
    // The workspaces come first, above the tools.
    const studio = (await page.getByTestId("nav-photography").boundingBox())!;
    const scene = (await page.getByTestId("tool-scene").boundingBox())!;
    expect(studio.y).toBeLessThan(scene.y);
  });

  test("the workspace menu is accessible and closes with Escape", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 800 });
    await page.goto("/photography");
    await page.getByTestId("nav-menu").click();
    await expect(page.getByTestId("nav-menu-list")).toBeVisible();
    await expect(page.getByTestId("nav-menu")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .include("[data-testid=nav-menu-list]")
      .analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("nav-menu-list")).toBeHidden();
  });
});

test("the Photography page has no automatically detectable WCAG A/AA violations", async ({
  page,
}) => {
  await page.goto("/photography");
  await expect(page.getByTestId("framing-portrait")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    r.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
});

test("Photography's framings fit the figure: portrait from mid-thigh with the head and hands, wide all of it", async ({
  page,
}) => {
  await page.goto("/photography");
  const scene = page.getByTestId("lighting-scene");
  await expect(scene).toHaveAttribute("data-status", "ready", {
    timeout: 90_000,
  });
  const box = (await scene.boundingBox())!;
  const inside = (p?: { x: number; y: number }) =>
    !!p &&
    p.x > box.x &&
    p.x < box.x + box.width &&
    p.y > box.y &&
    p.y < box.y + box.height;
  // The engine's camera follows the next frame: poll until it settles.
  const joints = () => jointsOnScreen(page);
  // The mannequin loads after the view is ready: wait for its joints.
  await expect
    .poll(async () => Object.keys(await joints()).length, { timeout: 60_000 })
    .toBeGreaterThan(10);

  // Portrait opens first.
  await expect.poll(async () => inside((await joints()).head)).toBe(true);
  const portrait = await joints();
  expect(inside(portrait.handL) && inside(portrait.handR)).toBe(true);
  // Cut mid-thigh: the hips are in the frame, the ankles below it (on a
  // tall, narrow view the arms set the distance and more legs show).
  const wideView = box.width >= box.height;
  expect(inside(portrait.hipL) && inside(portrait.hipR)).toBe(true);
  if (wideView) expect(portrait.ankleL.y).toBeGreaterThan(box.y + box.height);
  // The head (its neck pivot) in the upper part of the frame, as in a
  // portrait, with room above it.
  expect(portrait.head.y).toBeGreaterThan(box.y + box.height * 0.05);
  expect(portrait.head.y).toBeLessThan(box.y + box.height * 0.45);

  await page.getByTestId("framing-wide").click();
  await expect
    .poll(async () => {
      const j = await joints();
      return ["head", "handL", "handR", "ankleL", "ankleR"].every((k) =>
        inside(j[k]),
      );
    })
    .toBe(true);

  // Back to portrait after a wide shot: framed the same.
  await page.getByTestId("framing-portrait").click();
  // The same framing as on opening: the head back where it was.
  await expect
    .poll(async () => Math.abs((await joints()).head.y - portrait.head.y))
    .toBeLessThan(2);
});
