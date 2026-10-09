"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

const Reader = dynamic(
  () => import("@/components/my-day/my-day-needs-you-reader").then((module) => module.MyDayNeedsYouReader),
  { ssr: false },
);

/**
 * My Day's Needs you reader as a lazy chunk. The notification feed behind it
 * reads every work area's selectors, so it loads beside My Day's own reads
 * rather than in My Day's first load. Tests swap in the reader itself.
 */
export function LazyMyDayNeedsYouReader(props: ComponentProps<typeof Reader>) {
  return <Reader {...props} />;
}
