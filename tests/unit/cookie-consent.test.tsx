// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CONSENT_KEY } from "@/lib/consent";

afterEach(() => {
  // No globals: true in vitest.config, so testing-library's auto-cleanup
  // does not run — unmount explicitly or earlier tests' banners linger.
  cleanup();
  window.localStorage.clear();
  document.getElementById("plausible-script")?.remove();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
});

async function renderConsent() {
  const { default: CookieConsent } = await import("@/components/CookieConsent");
  return render(<CookieConsent />);
}

describe("CookieConsent", () => {
  it("shows the banner when no choice is stored", async () => {
    await renderConsent();
    expect(screen.getByTestId("cookie-consent-banner")).not.toBeNull();
  });

  it("hides the banner when a choice is already stored", async () => {
    window.localStorage.setItem(CONSENT_KEY, "declined");
    await renderConsent();
    expect(screen.queryByTestId("cookie-consent-banner")).toBeNull();
  });

  it("accept stores the choice and hides the banner", async () => {
    await renderConsent();
    fireEvent.click(screen.getByTestId("cookie-consent-accept"));
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("accepted");
    expect(screen.queryByTestId("cookie-consent-banner")).toBeNull();
  });

  it("decline stores the choice and loads no analytics script", async () => {
    process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN = "example.com";
    await renderConsent();
    fireEvent.click(screen.getByTestId("cookie-consent-decline"));
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("declined");
    expect(document.getElementById("plausible-script")).toBeNull();
  });

  it("accept loads the Plausible script only when a domain is configured", async () => {
    process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN = "example.com";
    await renderConsent();
    fireEvent.click(screen.getByTestId("cookie-consent-accept"));
    const script = document.getElementById("plausible-script");
    expect(script?.getAttribute("src")).toBe(
      "https://plausible.io/js/script.js",
    );
    expect(script?.getAttribute("data-domain")).toBe("example.com");
  });

  it("accept with no domain configured loads no script", async () => {
    await renderConsent();
    fireEvent.click(screen.getByTestId("cookie-consent-accept"));
    expect(document.getElementById("plausible-script")).toBeNull();
  });

  it("preferences save with analytics off stores declined", async () => {
    await renderConsent();
    fireEvent.click(screen.getByTestId("cookie-consent-preferences"));
    fireEvent.click(screen.getByTestId("cookie-consent-save-preferences"));
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("declined");
    expect(screen.queryByTestId("cookie-consent-banner")).toBeNull();
  });

  it("re-opens the preferences from the cookie-settings event", async () => {
    window.localStorage.setItem(CONSENT_KEY, "accepted");
    const { default: CookieSettingsButton } =
      await import("@/components/CookieSettingsButton");
    await renderConsent();
    render(<CookieSettingsButton />);
    fireEvent.click(screen.getByTestId("cookie-settings-open"));
    expect(screen.getByTestId("cookie-consent-banner")).not.toBeNull();
    const toggle = screen.getByTestId(
      "cookie-consent-analytics-toggle",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });
});
