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

/** Where each posable joint (plus `handL`/`handR`) is on screen, from
 * the engine's test hook (only present in automated browsers). */
export async function jointsOnScreen(
  page: Page,
  figure?: string,
): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(
    (f) =>
      (
        window as unknown as {
          __studioEngine: {
            jointsOnScreen(
              f?: string,
            ): Record<string, { x: number; y: number }>;
          };
        }
      ).__studioEngine.jointsOnScreen(f),
    figure,
  );
}

/** Is the canvas (not a panel over it) what's under this point? */
export async function onCanvas(
  page: Page,
  p: { x: number; y: number },
): Promise<boolean> {
  return page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.tagName === "CANVAS",
    p,
  );
}

/** How many pixels of the joint overlay's colours (JOINT_BLUE,
 * JOINT_GREEN in StudioEngine) are on the canvas. */
export async function overlayPixels(page: Page): Promise<number> {
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
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const near = (i: number, r: number, g: number, b: number) =>
      Math.abs(data[i] - r) < 16 &&
      Math.abs(data[i + 1] - g) < 16 &&
      Math.abs(data[i + 2] - b) < 16;
    let n = 0;
    for (let i = 0; i < data.length; i += 4)
      if (near(i, 0x4f, 0x86, 0xff) || near(i, 0x5c, 0xf2, 0x5c)) n++;
    return n;
  }, png.toString("base64"));
}

/** Press, move in small steps and release: a touch drag on touch
 * devices (via CDP, Chromium only), a mouse drag otherwise. */
export async function dragOnPage(
  page: Page,
  info: TestInfo,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const steps = 12;
  const at = (i: number) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  });
  if (info.project.use.hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, p?: { x: number; y: number }) =>
      cdp.send("Input.dispatchTouchEvent", {
        type: type as "touchStart",
        touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [],
      });
    await touch("touchStart", from);
    for (let i = 1; i <= steps; i++) await touch("touchMove", at(i));
    await touch("touchEnd");
    await cdp.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(at(i).x, at(i).y);
    await page.mouse.up();
  }
}
