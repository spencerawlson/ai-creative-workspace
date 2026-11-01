import { LightingScene } from "@/components/LightingScene";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 px-4 pb-3 pt-4 sm:px-6">
        <h1 className="text-xl font-semibold leading-tight sm:text-2xl">
          Lighting Studio — Pilot
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-snug text-zinc-400">
          M1: scene + mannequin + orbit only. Lights and presets come in M2.
        </p>
        <p className="mt-2 inline-block rounded-full bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200">
          Drag to rotate · Pinch to zoom
        </p>
      </header>
      <div className="h-[70dvh] shrink-0 px-3 pb-3 sm:px-6 sm:pb-6">
        <LightingScene />
      </div>
    </main>
  );
}
