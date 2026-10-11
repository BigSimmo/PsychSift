"use client";

import dynamic from "next/dynamic";

const LazyCounts = dynamic(
  () => import("@/components/work-frame/work-side-counts-reader").then((module) => module.WorkSideCountsReader),
  { ssr: false },
);

/**
 * The side menu and rail's counts, read only while one of them is on screen. Kept apart from
 * lazy-work-side-nav so the clinical sidebar can use it without importing the two-pane menu,
 * which imports the clinical sidebar back.
 */
export function LazyWorkSideCounts({ active }: { readonly active: boolean }) {
  return active ? <LazyCounts /> : null;
}
