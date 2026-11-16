/** Cookie-consent state (R-04). The app sets no cookies itself; the only
 * non-essential tracker is Plausible analytics (cookieless), which loads
 * only after the visitor accepts. The choice lives in localStorage so no
 * cookie is needed to remember it. */

export const CONSENT_KEY = "iko-cookie-consent";

export type ConsentChoice = "accepted" | "declined";

/** Event fired (on window) to re-open the banner's preference view,
 * e.g. from the "Cookie settings" link in the footer. */
export const OPEN_SETTINGS_EVENT = "iko:open-cookie-settings";

export function openCookieSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readConsent(): ConsentChoice | null {
  const value = storage()?.getItem(CONSENT_KEY);
  return value === "accepted" || value === "declined" ? value : null;
}

export function writeConsent(choice: ConsentChoice): void {
  try {
    storage()?.setItem(CONSENT_KEY, choice);
  } catch {
    // Private mode / blocked storage: the banner just shows again.
  }
}
