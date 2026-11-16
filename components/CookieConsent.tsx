"use client";

/** Cookie consent banner + preference control (R-04).
 *
 * Nothing non-essential loads before a choice: the only tracker is
 * Plausible analytics (cookieless), and its script is injected only
 * after the visitor accepts — and only when a Plausible domain is
 * configured (lib/site.ts). Declining, or never choosing, means no
 * analytics script ever loads. The choice is stored in localStorage
 * (the app sets no cookies itself); "Cookie settings" links dispatch
 * `iko:open-cookie-settings` to bring the banner back. */

import { useEffect, useState } from "react";
import {
  OPEN_SETTINGS_EVENT,
  readConsent,
  writeConsent,
  type ConsentChoice,
} from "@/lib/consent";
import { plausibleDomain } from "@/lib/site";

const PLAUSIBLE_SCRIPT_ID = "plausible-script";
const PLAUSIBLE_SRC = "https://plausible.io/js/script.js";

function loadPlausible(): void {
  if (typeof document === "undefined") return;
  if (!plausibleDomain) return;
  if (document.getElementById(PLAUSIBLE_SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = PLAUSIBLE_SCRIPT_ID;
  script.defer = true;
  script.setAttribute("data-domain", plausibleDomain);
  script.src = PLAUSIBLE_SRC;
  document.head.appendChild(script);
}

function unloadPlausible(): void {
  document.getElementById(PLAUSIBLE_SCRIPT_ID)?.remove();
}

export default function CookieConsent() {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  // Visible on first paint (including server-rendered HTML) until the
  // stored choice says otherwise — the banner must be present before
  // any tracker loads, and a curl of the homepage should find it.
  const [visible, setVisible] = useState(true);
  const [showPreferences, setShowPreferences] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(false);

  useEffect(() => {
    const stored = readConsent();
    setChoice(stored);
    setAnalyticsOn(stored === "accepted");
    setVisible(stored === null);
  }, []);

  useEffect(() => {
    const reopen = () => {
      setAnalyticsOn(choice === "accepted");
      setShowPreferences(true);
      setVisible(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, reopen);
  }, [choice]);

  useEffect(() => {
    if (choice === "accepted") loadPlausible();
    else unloadPlausible();
  }, [choice]);

  if (!visible) return null;

  const choose = (next: ConsentChoice) => {
    writeConsent(next);
    setChoice(next);
    setVisible(false);
    setShowPreferences(false);
  };

  const savePreferences = () => choose(analyticsOn ? "accepted" : "declined");

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      data-testid="cookie-consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-ink-700 bg-ink-900 px-4 py-4 shadow-xl sm:px-6"
    >
      <div className="mx-auto max-w-6xl">
        {showPreferences ? (
          <>
            <p className="text-sm font-semibold text-ink-100">
              Cookie preferences
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-300">
              IKO 3D sets no cookies itself. The only optional tracker is
              Plausible analytics — cookieless, no cross-site tracking — and it
              loads only if you switch it on below.
            </p>
            <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-ink-100">
              <input
                type="checkbox"
                checked={analyticsOn}
                onChange={(e) => setAnalyticsOn(e.target.checked)}
                data-testid="cookie-consent-analytics-toggle"
                className="h-4 w-4 accent-emerald-400"
              />
              Analytics (Plausible, cookieless)
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={savePreferences}
                data-testid="cookie-consent-save-preferences"
                className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-accent-strong"
              >
                Save preferences
              </button>
              <button
                type="button"
                onClick={() => setVisible(false)}
                className="inline-flex min-h-11 items-center rounded-full border border-ink-700 px-5 py-2.5 text-sm font-medium text-ink-100 hover:border-ink-600"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-ink-100">
              IKO 3D sets no cookies itself. We use Plausible — cookieless
              analytics with no cross-site tracking — only if you accept.{" "}
              <a href="/privacy" className="text-accent underline">
                Privacy policy
              </a>
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => choose("accepted")}
                data-testid="cookie-consent-accept"
                className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-accent-strong"
              >
                Accept analytics
              </button>
              <button
                type="button"
                onClick={() => choose("declined")}
                data-testid="cookie-consent-decline"
                className="inline-flex min-h-11 items-center rounded-full border border-ink-700 px-5 py-2.5 text-sm font-medium text-ink-100 hover:border-ink-600"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => setShowPreferences(true)}
                data-testid="cookie-consent-preferences"
                className="inline-flex min-h-11 items-center rounded-full border border-ink-700 px-5 py-2.5 text-sm font-medium text-ink-100 hover:border-ink-600"
              >
                Customise
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
