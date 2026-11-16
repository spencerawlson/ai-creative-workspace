"use client";

/** "Cookie settings" link: re-opens the consent banner's preference
 * view (lib/consent.ts). Rendered in footers/menus so the choice can be
 * changed after the banner is dismissed. */

import { openCookieSettings } from "@/lib/consent";

export default function CookieSettingsButton({
  className,
}: {
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={openCookieSettings}
      data-testid="cookie-settings-open"
      className={className}
    >
      Cookie settings
    </button>
  );
}
