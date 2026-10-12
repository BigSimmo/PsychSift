"use client";

import dynamic from "next/dynamic";

/**
 * The Recent pages recorder draws nothing and only writes after a page settles,
 * so it loads just after the page instead of adding to every page's first download.
 */
export const RecentPagesRecorderDeferred = dynamic(
  () => import("@/components/recent-pages/recent-pages-recorder").then((m) => m.RecentPagesRecorder),
  { ssr: false },
);
