import type { Metadata } from "next";
import { SculptStudio } from "@/components/sculpt/SculptStudio";

export const metadata: Metadata = {
  title: "Sculpt — IKO 3D",
  description:
    "Sculpt digital clay in the browser with IKO 3D: draw, clay, inflate, smooth, flatten, pinch and grab brushes, symmetry, pen pressure, and STL export for 3D printing.",
};

export default function SculptPage() {
  return <SculptStudio />;
}
