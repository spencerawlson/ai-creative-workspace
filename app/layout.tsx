import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "I-K-O 3D",
  description:
    "I-K-O 3D: light, pose and animate 3D mannequins in the browser. Studio lights and presets, typed poses and moves, keyframes, share links, image and video export.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover is what makes safe-area-inset-* non-zero on
  // notched iPhones; without it the insets below are all 0.
  viewportFit: "cover",
  themeColor: "#09090c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
