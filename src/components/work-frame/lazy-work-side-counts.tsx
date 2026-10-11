"use client";

import dynamic from "next/dynamic";

const LazyCounts = dynamic(
  () => import("@/components/work-frame/work-side-counts-reader").then((module) => module.WorkSideCountsReader),
  { ssr: false },
);

/**
 * The side menu and rail's counts, read only while one of them is on screen.
 * Its own module so the clinical side menu can load it without importing the
 * lazy side-menu loaders, which would close an import cycle back to itself.
 */
export function LazyWorkSideCounts({ active }: { readonly active: boolean }) {
  return active ? <LazyCounts /> : null;
}
