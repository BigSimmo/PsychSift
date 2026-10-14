"use client";

import dynamic from "next/dynamic";

// Its own leaf module: the clinical sidebar imports it, so it must not pull in the
// side menus (two-pane-side-menu imports the clinical sidebar back).
const LazyCounts = dynamic(
  () => import("@/components/work-frame/work-side-counts-reader").then((module) => module.WorkSideCountsReader),
  { ssr: false },
);

/** The side menu and rail's counts, read only while one of them is on screen. */
export function LazyWorkSideCounts({ active }: { readonly active: boolean }) {
  return active ? <LazyCounts /> : null;
}
