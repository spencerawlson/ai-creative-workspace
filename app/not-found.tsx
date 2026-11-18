import Link from "next/link";

/** Custom 404 page. Next serves this with a 404 status for unknown
 * paths (no redirect, no app-shell 200). */

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-ink-950 text-ink-100">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm font-medium text-accent">Zaka 3D</p>
        <h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
        <p className="mt-4 text-base leading-relaxed text-ink-300">
          That page doesn&apos;t exist — it may have moved, or the link may have
          a typo.
        </p>
        <p className="mt-6 text-sm text-ink-400">
          <Link href="/" className="hover:text-ink-100 hover:underline">
            Home
          </Link>
          {" · "}
          <Link href="/studio" className="hover:text-ink-100 hover:underline">
            Studio
          </Link>
          {" · "}
          <Link
            href="/photography"
            className="hover:text-ink-100 hover:underline"
          >
            Photography
          </Link>
          {" · "}
          <Link href="/sculpt" className="hover:text-ink-100 hover:underline">
            Sculpt
          </Link>
        </p>
      </div>
    </main>
  );
}
