import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy policy — IKO 3D",
  description:
    "How IKO 3D handles your data: everything stays on your device, no accounts, no uploads, and analytics only with your consent.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-ink-950 text-ink-100">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm font-medium text-accent">IKO 3D</p>
        <h1 className="mt-2 text-3xl font-semibold">Privacy policy</h1>
        <p className="mt-2 text-sm text-ink-400">
          Last updated: 16 November 2026
        </p>

        <section className="mt-8 space-y-4 text-base leading-relaxed text-ink-300">
          <p>
            IKO 3D is a creative tool that runs entirely in your browser. There
            are no accounts, no sign-in, no backend, and nothing you make is
            uploaded to a server.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-ink-100">
            What stays on your device
          </h2>
          <p>
            Your scenes, poses, keyframes, and settings are stored in your
            browser&apos;s local storage, on your own device. Characters you
            import (GLB or VRM files) stay on your device too. If you pose a
            figure from a photo, that photo never leaves your device — the pose
            detection runs locally in your browser.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-ink-100">
            Share links
          </h2>
          <p>
            A share link carries the whole scene — lights, poses, keyframes —
            inside the link itself. Anyone you send the link to can open the
            same scene. Don&apos;t share a link to a scene you want to keep
            private. Imported characters are never included in a share link:
            other people see the mannequin instead.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-ink-100">Analytics</h2>
          <p>
            We use Plausible, a privacy-friendly analytics tool that sets no
            cookies and does no cross-site tracking. It only loads after you
            accept analytics in the cookie banner — if you decline, or never
            choose, no analytics script loads at all. You can change your choice
            at any time from the &ldquo;Cookie settings&rdquo; link in the
            footer.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-ink-100">Cookies</h2>
          <p>
            IKO 3D sets no cookies itself. Your cookie-consent choice is
            remembered in your browser&apos;s local storage, not in a cookie.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-ink-100">
            Changes to this policy
          </h2>
          <p>
            If this policy changes, the &ldquo;Last updated&rdquo; date above
            changes with it. Questions about this policy can be raised on the
            project&apos;s GitHub repository
            (spencerawlson/ai-creative-workspace).
          </p>
        </section>

        <p className="mt-10 border-t border-ink-800 pt-6 text-sm text-ink-400">
          <Link href="/terms" className="hover:text-ink-100 hover:underline">
            Terms of use
          </Link>
          {" · "}
          <Link href="/" className="hover:text-ink-100 hover:underline">
            Back to IKO 3D
          </Link>
        </p>
      </div>
    </main>
  );
}
