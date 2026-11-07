import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openStudio, showPanel, sParam } from "./helpers";

test.describe("Landing page", () => {
  test("loads with the hero, the portrait and both CTAs", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("/");
    await expect(page.getByTestId("landing-page")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Light, pose and animate 3D characters — right in your browser.",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("landing-portrait")).toBeVisible();
    await expect(page.getByTestId("cta-open-studio")).toHaveAttribute(
      "href",
      "/studio",
    );
    await expect(page.getByTestId("cta-photography")).toHaveAttribute(
      "href",
      "/photography",
    );
    expect(errors).toEqual([]);
  });

  test("opening the studio CTA lands on the studio", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("cta-open-studio").first().click();
    await expect(page.getByTestId("lighting-scene")).toHaveAttribute(
      "data-status",
      "ready",
      { timeout: 90_000 },
    );
  });

  test("a share link on the root redirects to the studio and applies the scene", async ({
    page,
    browser,
  }) => {
    await openStudio(page);
    await showPanel(page, "presets");
    const initial = await sParam(page);
    await page.getByTestId("preset-rembrandt").click();
    await expect.poll(() => sParam(page)).not.toBe(initial);
    const url = new URL(page.url());

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await page2.goto(`/?s=${url.searchParams.get("s")}`);
    await expect(page2).toHaveURL(/\/studio\?s=/);
    await showPanel(page2, "presets");
    await expect(page2.getByTestId("preset-rembrandt")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await other.close();
  });

  test("the drawing video is present and its play/pause control works", async ({
    page,
  }) => {
    await page.goto("/");
    const video = page.getByTestId("process-video");
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute("src", "/landing/drawing-process.mp4");
    const toggle = page.getByRole("button", {
      name: /Pause the drawing video|Play the drawing video/,
    });
    const before = await video.evaluate((v) => (v as HTMLVideoElement).paused);
    await toggle.click();
    await expect
      .poll(() => video.evaluate((v) => (v as HTMLVideoElement).paused))
      .toBe(!before);
  });

  test("landing page has no automatically detectable WCAG A/AA violations", async ({
    page,
  }) => {
    await page.goto("/");
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
