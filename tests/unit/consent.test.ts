// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  CONSENT_KEY,
  OPEN_SETTINGS_EVENT,
  openCookieSettings,
  readConsent,
  writeConsent,
} from "@/lib/consent";

describe("cookie consent storage", () => {
  it("reads null with no stored choice", () => {
    window.localStorage.clear();
    expect(readConsent()).toBeNull();
  });

  it("round-trips accepted and declined", () => {
    writeConsent("accepted");
    expect(readConsent()).toBe("accepted");
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("accepted");
    writeConsent("declined");
    expect(readConsent()).toBe("declined");
  });

  it("ignores a bogus stored value", () => {
    window.localStorage.setItem(CONSENT_KEY, "maybe");
    expect(readConsent()).toBeNull();
  });

  it("openCookieSettings dispatches the re-open event", () => {
    let seen = false;
    const onEvent = () => {
      seen = true;
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onEvent);
    openCookieSettings();
    window.removeEventListener(OPEN_SETTINGS_EVENT, onEvent);
    expect(seen).toBe(true);
  });
});
