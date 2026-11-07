/** A share link that lands on the old root (`/?s=...`) belongs to the
 * studio, which now lives at `/studio`. Returns the `/studio` URL with
 * the same query string, or null for a plain visit (no share param).
 *
 * Only a non-empty `s` redirects: `/?s=` (empty) is a malformed link,
 * and the studio would only answer it with a "damaged link" notice —
 * the landing page is the better answer there. */

export function studioRedirectTarget(
  searchParams: Record<string, string | string[] | undefined>,
): string | null {
  const s = searchParams.s;
  if (typeof s !== "string" || s === "") return null;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.append(key, value);
  }
  const q = qs.toString();
  return q ? `/studio?${q}` : "/studio";
}
