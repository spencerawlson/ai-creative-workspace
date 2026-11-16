/** The site's public base URL, used for absolute metadata (openGraph,
 * sitemap, robots). It comes from NEXT_PUBLIC_SITE_URL when set; until
 * Spencer supplies the real Vercel URL (R-15) it stays the placeholder —
 * do NOT replace this with a guessed URL. */
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";

/** Plausible analytics domain (the site's real hostname, as registered
 * in Plausible). Empty until the live URL is known — the analytics script
 * is not rendered without it, so nothing ever phones home to a wrong
 * domain. Set alongside NEXT_PUBLIC_SITE_URL once the URL exists. */
export const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "";
