import { expect, type Page, type TestInfo } from "@playwright/test";

export const isMobile = (info: TestInfo) => info.project.name === "mobile";

/** Open the studio and wait until WebGL is running and the model loaded. */
export async function openStudio(
  page: Page,
  path = "/",
  /** Runs right after navigation, before waiting for WebGL — for
   * assertions on transient startup notices. */
  beforeReady?: () => Promise<void>,
) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(path);
  await beforeReady?.();
  await expect(page.getByTestId("lighting-scene")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 90_000 },
  );
  return errors;
}

/** Show a left panel on any layout (tool rail on desktop/tablet, tabs on mobile). */
export async function showPanel(
  page: Page,
  panel: "scene" | "presets" | "history",
) {
  const tab = page.getByTestId(`tab-${panel}`);
  if (await tab.isVisible()) {
    await tab.click();
    return;
  }
  const tool = page.getByTestId(`tool-${panel}`);
  if ((await tool.getAttribute("aria-pressed")) !== "true") await tool.click();
}

export async function sParam(page: Page): Promise<string | null> {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("s"))
    .not.toBeNull();
  return new URL(page.url()).searchParams.get("s");
}

/** Mean pixel brightness of the WebGL canvas, read from a screenshot. */
export async function canvasBrightness(page: Page): Promise<number> {
  const png = await page.getByTestId("lighting-scene").screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) / 3;
  }, png.toString("base64"));
}
