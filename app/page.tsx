import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProcessVideo } from "@/components/landing/ProcessVideo";
import { studioRedirectTarget } from "@/lib/studio/landing-redirect";

export const metadata: Metadata = {
  title: "I-K-O 3D — Light, pose and animate 3D characters",
  description:
    "A studio for lighting, posing and animating 3D figures. Real Three.js light, presets a photographer would recognise, and share links that reproduce the whole scene. No accounts, no uploads, nothing to install.",
  openGraph: {
    title: "I-K-O 3D — Light, pose and animate 3D characters",
    description:
      "Light, pose and animate 3D characters — right in your browser.",
    images: [
      {
        url: "/landing/portrait.jpg",
        width: 1206,
        height: 1206,
        alt: "A stylised portrait of a young man, drawn in black line art with grey tones",
      },
    ],
  },
};

const FEATURES = [
  {
    title: "Studio lights",
    body: "Up to 8 lights — key, fill, rim, softbox — with colour temperature, shadows and softness. Six presets a photographer would recognise: Three-point, Rembrandt, Split, Butterfly, Low-key, High-key.",
  },
  {
    title: "Pose by hand, by word, or by photo",
    body: "Drag a joint in the viewport, type “walk slowly” or “dance 1 minute”, or pose a figure from a photo on your device. Fingers, hands and faces included.",
  },
  {
    title: "Keyframe animation",
    body: "A timeline with play, scrub, auto-key and a graph editor. Export MP4 or WebM, rendered frame by frame in the browser.",
  },
  {
    title: "Your own characters",
    body: "Import GLB or VRM characters. They take every pose, move and keyframe the mannequin does, and stay on your device — share links show the mannequin to others.",
  },
  {
    title: "Faces",
    body: "Expressions, blinks, winks and mouth shapes on characters that support them. They key, ease and share like any joint.",
  },
  {
    title: "Render quality & lens look",
    body: "Depth of field, bloom, vignette and film grain. PNG/JPEG export up to the device limit, with transparent backgrounds.",
  },
];

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Old share links point at the root (/?s=...). The studio lives at
  // /studio now — send them there with the same query.
  const target = studioRedirectTarget(await searchParams);
  if (target) redirect(target);

  return (
    <main
      data-testid="landing-page"
      className="min-h-dvh bg-ink-950 text-ink-100"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <header className="flex items-center gap-2 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 28 px static logo */}
          <img
            src="/brand/iko-logo-128.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0"
          />
          <span className="text-sm font-semibold">I-K-O 3D</span>
          <nav aria-label="Sections" className="ml-auto text-sm">
            <Link
              href="/photography"
              className="text-ink-300 hover:text-ink-100 hover:underline"
            >
              Photography →
            </Link>
          </nav>
        </header>

        <section
          aria-labelledby="landing-hero"
          className="grid items-center gap-8 py-8 sm:py-12 lg:grid-cols-2"
        >
          <div>
            <p className="text-sm font-medium text-accent">I-K-O 3D</p>
            <h1
              id="landing-hero"
              className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl"
            >
              Light, pose and animate 3D characters — right in your browser.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-ink-300">
              A studio for lighting, posing and animating 3D figures. Real
              Three.js light, presets a photographer would recognise, and share
              links that reproduce the whole scene. No accounts, no uploads,
              nothing to install.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/studio"
                data-testid="cta-open-studio"
                className="inline-flex min-h-11 items-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink-950 hover:bg-accent-strong"
              >
                Open the studio
              </Link>
              <Link
                href="/photography"
                data-testid="cta-photography"
                className="inline-flex min-h-11 items-center rounded-full border border-ink-700 px-6 py-3 text-sm font-medium text-ink-100 hover:border-ink-600"
              >
                Learn the camera
              </Link>
            </div>
          </div>
          <div data-testid="landing-portrait">
            <Image
              src="/landing/portrait.jpg"
              alt="A stylised portrait of a young man, drawn in black line art with grey tones"
              width={1206}
              height={1206}
              priority
              className="w-full rounded-2xl border border-ink-800"
            />
            <p className="mt-2 text-sm text-ink-400">
              Drawn by hand — the kind of character the studio lights, poses and
              animates.
            </p>
          </div>
        </section>

        <section aria-labelledby="landing-features" className="py-8 sm:py-12">
          <h2
            id="landing-features"
            className="text-2xl font-semibold sm:text-3xl"
          >
            What you can do
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="rounded-2xl border border-ink-800 bg-ink-900 p-5"
              >
                <h3 className="text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-300">
                  {f.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="landing-process"
          className="grid items-center gap-8 py-8 sm:py-12 lg:grid-cols-2"
        >
          <div className="lg:order-2">
            <h2
              id="landing-process"
              className="text-2xl font-semibold sm:text-3xl"
            >
              From sketch to character
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink-300">
              The portrait above, drawn line by line. The drawing is the
              artist&rsquo;s own work — the studio is where characters like this
              get lit, posed and animated.
            </p>
            <p className="mt-3 text-base leading-relaxed text-ink-300">
              Pose from a photo works the same way round: the photo never leaves
              your device, and the figure takes the pose.
            </p>
          </div>
          <div className="lg:order-1">
            <ProcessVideo />
          </div>
        </section>

        <section
          aria-labelledby="landing-share"
          className="rounded-2xl border border-ink-800 bg-ink-900 px-5 py-6 sm:px-8"
        >
          <h2 id="landing-share" className="text-xl font-semibold sm:text-2xl">
            Share a link, share the scene
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-300 sm:text-base">
            Every setup has a link that opens the same scene — lights, poses,
            keyframes — on another phone. Links from the early version still
            open.
          </p>
          <div className="mt-4">
            <Link
              href="/studio"
              className="inline-flex min-h-11 items-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink-950 hover:bg-accent-strong"
            >
              Open the studio
            </Link>
          </div>
        </section>

        <footer className="border-t border-ink-800 py-8 text-sm text-ink-400">
          <p>
            I-K-O 3D — no accounts, no backend, free. The pose finder runs
            entirely in your browser.
          </p>
          <p className="mt-2">
            <Link href="/studio" className="hover:text-ink-100 hover:underline">
              Studio
            </Link>
            {" · "}
            <Link
              href="/photography"
              className="hover:text-ink-100 hover:underline"
            >
              Photography — Camera Basics
            </Link>
          </p>
        </footer>
      </div>
    </main>
  );
}
