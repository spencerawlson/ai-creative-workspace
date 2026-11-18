import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of use — Zaka 3D",
  description:
    "The terms for using Zaka 3D: a free, no-account browser studio for lighting, posing and animating 3D characters.",
};

export default function TermsPage() {
  return (
    <main className="min-h-dvh bg-ink-950 text-ink-100">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm font-medium text-accent">Zaka 3D</p>
        <h1 className="mt-2 text-3xl font-semibold">Terms of use</h1>
        <p className="mt-2 text-sm text-ink-400">
          Last updated: 16 November 2026
        </p>

        <section className="mt-8 space-y-4 text-base leading-relaxed text-ink-300">
          <p>
            Zaka 3D is a free, no-account studio for lighting, posing, and
            animating 3D characters in your browser. By using it, you agree to
            these terms.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-ink-100">
            The service
          </h2>
          <p>
            Zaka 3D is provided &ldquo;as is&rdquo;, without warranties of any
            kind. It runs entirely in your browser: there is no backend storing
            your work, so we cannot recover a scene you lose, and the service
            may change or stop at any time.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-ink-100">
            Your content
          </h2>
          <p>
            What you make stays yours. Scenes you create, characters you import,
            and images you export belong to you. You are responsible for having
            the right to use anything you import — don&apos;t upload characters,
            images, or other material you don&apos;t have the rights to, and
            don&apos;t use the studio to infringe anyone&apos;s rights or to
            misrepresent someone else&apos;s work as your own.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-ink-100">
            Acceptable use
          </h2>
          <p>
            Don&apos;t use Zaka 3D to break the law, to harass or deceive
            anyone, or to interfere with the service for others. Share links
            reproduce the scene they carry, so don&apos;t share a link to
            content you don&apos;t want others to see.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-ink-100">
            Changes to these terms
          </h2>
          <p>
            If these terms change, the &ldquo;Last updated&rdquo; date above
            changes with it. Questions about these terms can be raised on the
            project&apos;s GitHub repository
            (spencerawlson/ai-creative-workspace).
          </p>
        </section>

        <p className="mt-10 border-t border-ink-800 pt-6 text-sm text-ink-400">
          <Link href="/privacy" className="hover:text-ink-100 hover:underline">
            Privacy policy
          </Link>
          {" · "}
          <Link href="/" className="hover:text-ink-100 hover:underline">
            Back to Zaka 3D
          </Link>
        </p>
      </div>
    </main>
  );
}
