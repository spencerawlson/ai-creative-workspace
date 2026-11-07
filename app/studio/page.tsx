import type { Metadata } from "next";
import { LightingStudio } from "@/components/studio/LightingStudio";

export const metadata: Metadata = {
  title: "Studio — I-K-O 3D",
  description:
    "The I-K-O 3D studio: light, pose and animate 3D mannequins in the browser. Studio lights and presets, typed poses and moves, keyframes, share links, image and video export.",
};

export default function StudioPage() {
  return <LightingStudio />;
}
