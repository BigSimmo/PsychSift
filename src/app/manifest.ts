import type { MetadataRoute } from "next";

import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";
import { APP_THEME_COLORS } from "@/lib/theme";

// PWA manifest — makes the app installable with a proper icon. Icons derive from
// the single brand-mark source: the SVG for modern browsers, plus generated PNG
// "any" and "maskable" sets from app/icons/[variant]. background_color matches
// the brand light splash (APP_THEME_COLORS.light). theme_color stays off the
// manifest and on viewport.themeColor / meta theme-color (see app/layout.tsx
// and use-theme.ts) so light/dark can update without a static colour lock.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    id: "/",
    start_url: "/",
    scope: "/",
    lang: "en-AU",
    dir: "ltr",
    display: "standalone",
    // Prefer the standalone window but allow a graceful minimal-ui fallback on
    // platforms that cannot honour it; never fall back to fullscreen.
    display_override: ["standalone", "minimal-ui"],
    // Focus the already-open app window on launch instead of spawning a second
    // instance; "auto" lets platforms without the capability use their default.
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
    categories: ["medical", "productivity", "utilities", "education"],
    prefer_related_applications: false,
    // Splash / install canvas only — not the dynamic browser chrome colour.
    background_color: APP_THEME_COLORS.light,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icons/icon-192", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icons/icon-512", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icons/maskable-192", type: "image/png", sizes: "192x192", purpose: "maskable" },
      { src: "/icons/maskable-512", type: "image/png", sizes: "512x512", purpose: "maskable" },
      { src: "/icons/monochrome-192", type: "image/png", sizes: "192x192", purpose: "monochrome" },
      { src: "/icons/monochrome-512", type: "image/png", sizes: "512x512", purpose: "monochrome" },
    ],
    shortcuts: [
      {
        name: `Ask ${BRAND_NAME}`,
        short_name: "Ask",
        description: "Open a source-backed clinical question",
        url: "/?mode=answer&focus=1",
        icons: [{ src: "/icons/icon-192", type: "image/png", sizes: "192x192" }],
      },
      {
        name: "Search documents",
        short_name: "Documents",
        description: "Find source documents and evidence passages",
        url: "/documents/search?mode=documents&focus=1",
        icons: [{ src: "/icons/icon-192", type: "image/png", sizes: "192x192" }],
      },
      {
        name: "Medication guidance",
        short_name: "Medication",
        description: "Open medication dosing and monitoring guidance",
        url: "/medications?focus=1",
        icons: [{ src: "/icons/icon-192", type: "image/png", sizes: "192x192" }],
      },
      {
        name: "Differentials",
        short_name: "Differentials",
        description: "Compare causes and clinical clues",
        url: "/differentials?focus=1",
        icons: [{ src: "/icons/icon-192", type: "image/png", sizes: "192x192" }],
      },
      {
        name: "On-Call Handbook",
        short_name: "On Call",
        description: "Open on-call contacts, rosters, and quick handbooks",
        url: "/on-call?focus=1",
        icons: [{ src: "/icons/icon-192", type: "image/png", sizes: "192x192" }],
      },
      {
        name: "CPD Tracking",
        short_name: "CPD",
        description: "Track continuing professional development hours and activities",
        url: "/cme?focus=1",
        icons: [{ src: "/icons/icon-192", type: "image/png", sizes: "192x192" }],
      },
      {
        name: "Log CPD",
        short_name: "Log CPD",
        description: "Open a new CPD activity entry",
        url: "/cme/new",
        icons: [{ src: "/icons/icon-192", type: "image/png", sizes: "192x192" }],
      },
    ],
  };
}
