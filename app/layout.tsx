import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import CookieConsent from "@/components/CookieConsent";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const description =
  "IKO 3D: light, pose and animate 3D mannequins in the browser. Studio lights and presets, typed poses and moves, keyframes, share links, image and video export.";

export const metadata: Metadata = {
  // Placeholder until the real Vercel URL is known (R-15); set via
  // NEXT_PUBLIC_SITE_URL. Never a guessed URL.
  metadataBase: new URL(siteUrl),
  title: "IKO 3D",
  description,
  openGraph: {
    title: "IKO 3D — Light, pose and animate 3D characters",
    description:
      "Light, pose and animate 3D characters — right in your browser.",
    url: siteUrl,
    siteName: "IKO 3D",
    type: "website",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "IKO 3D — light, pose and animate 3D characters in your browser",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "IKO 3D — Light, pose and animate 3D characters",
    description:
      "Light, pose and animate 3D characters — right in your browser.",
    images: ["/og.jpg"],
  },
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
      <body>
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
