import { expect, test } from "@playwright/test";

test.describe("Legal pages and consent (R-03, R-04, R-13)", () => {
  test("/privacy and /terms serve real content", async ({ page }) => {
    for (const [path, heading] of [
      ["/privacy", "Privacy policy"],
      ["/terms", "Terms of use"],
    ] as const) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }
  });

  test("unknown paths return a 404 status with the custom page", async ({
    page,
  }) => {
    const response = await page.goto("/this-page-does-not-exist-12345");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
  });

  test("/robots.txt and /sitemap.xml serve", async ({ page }) => {
    const robots = await page.goto("/robots.txt");
    expect(robots?.status()).toBe(200);
    expect(await robots?.text()).toContain("Sitemap:");
    const sitemap = await page.goto("/sitemap.xml");
    expect(sitemap?.status()).toBe(200);
    const body = (await sitemap?.text()) ?? "";
    expect(body).toContain("/studio");
    expect(body).toContain("/privacy");
    expect(body).toContain("/terms");
  });

  test("cookie banner shows, accepts, and stays dismissed", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    const banner = page.getByTestId("cookie-consent-banner");
    await expect(banner).toBeVisible();
    await page.getByTestId("cookie-consent-accept").click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(banner).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("cookie settings re-opens the preferences", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("cookie-consent-decline").click();
    await expect(page.getByTestId("cookie-consent-banner")).toBeHidden();
    await page.getByTestId("cookie-settings-open").click();
    await expect(page.getByTestId("cookie-consent-banner")).toBeVisible();
    await expect(
      page.getByTestId("cookie-consent-analytics-toggle"),
    ).not.toBeChecked();
  });

  test("footer links to privacy and terms", async ({ page }) => {
    await page.goto("/");
    const landing = page.getByTestId("landing-page");
    await expect(
      landing.getByRole("link", { name: "Privacy", exact: true }),
    ).toHaveAttribute("href", "/privacy");
    await expect(
      landing.getByRole("link", { name: "Terms", exact: true }),
    ).toHaveAttribute("href", "/terms");
  });

  test("accepting analytics loads the Plausible script when a domain is configured", async ({
    page,
  }) => {
    // Runs only when the build was made with a Plausible domain:
    // NEXT_PUBLIC_PLAUSIBLE_DOMAIN must be set both at build time (it is
    // baked into the client bundle) and here. Skipped in CI, where no
    // domain is configured yet.
    test.skip(
      !process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
      "no Plausible domain configured",
    );
    await page.goto("/");
    await page.getByTestId("cookie-consent-accept").click();
    const script = page.locator("#plausible-script");
    await expect(script).toHaveAttribute(
      "src",
      "https://plausible.io/js/script.js",
    );
    await expect(script).toHaveAttribute(
      "data-domain",
      process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN!,
    );
  });
});
