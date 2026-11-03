import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openStudio, showPanel, timelineControl } from "./helpers";

/** Automated WCAG 2.1 A/AA checks. Automated tools catch roughly a third
 * of issues; keyboard and screen-reader passes are still manual. */
async function axe(page: import("@playwright/test").Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return r.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

test("studio has no automatically detectable WCAG A/AA violations", async ({
  page,
}) => {
  await openStudio(page);
  expect(await axe(page)).toEqual([]);
  await showPanel(page, "scene");
  await page.getByTestId("node-light-key").click();
  expect(await axe(page)).toEqual([]);
  await showPanel(page, "scene");
  await page.getByTestId("node-pose").click();
  await expect(page.getByTestId("pose-preset-neutral")).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("dialogs are accessible", async ({ page }) => {
  await openStudio(page);
  await page.getByTestId("export-open").click();
  await expect(page.getByTestId("export-dialog")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("export-dialog")).toBeHidden();
  // The video dialog needs an animation: set one key.
  await (await timelineControl(page, "timeline-set-key")).click();
  await (await timelineControl(page, "timeline-video")).click();
  await expect(page.getByTestId("video-dialog")).toBeVisible();
  await expect(page.getByTestId("video-summary")).not.toContainText("Checking");
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("video-dialog")).toBeHidden();
});

test("keyboard: viewport is focusable and orbits with arrow keys", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile", "no hardware keyboard on phones");
  await openStudio(page);
  const viewport = page.getByTestId("lighting-scene");
  await viewport.focus();
  await expect(viewport).toBeFocused();
  const before = await viewport.screenshot();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => Buffer.compare(before, await viewport.screenshot()))
    .not.toBe(0);
});

test("keyboard: L selects a light and arrow keys move its handle", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile", "no hardware keyboard on phones");
  await openStudio(page);
  const viewport = page.getByTestId("lighting-scene");
  await viewport.focus();
  await page.keyboard.press("l");
  const azimuth = page.getByTestId("light-azimuth");
  await expect(azimuth).toBeVisible();
  const before = Number(await azimuth.inputValue());
  await expect(viewport).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(azimuth).toHaveValue(String((before + 20) % 360));
  await expect(page.getByTestId("viewport-announcement")).toContainText(
    `direction ${(before + 20) % 360}°`,
  );
  // Both nudges coalesce into a single undo step.
  await page.getByTestId("undo").click();
  await expect(azimuth).toHaveValue(String(before));
});
