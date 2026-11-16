import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: Array<{ path: string; priority: number }> = [
    { path: "/", priority: 1 },
    { path: "/studio", priority: 0.9 },
    { path: "/photography", priority: 0.8 },
    { path: "/sculpt", priority: 0.8 },
    { path: "/privacy", priority: 0.3 },
    { path: "/terms", priority: 0.3 },
  ];
  const now = new Date();
  return pages.map(({ path, priority }) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    priority,
  }));
}
