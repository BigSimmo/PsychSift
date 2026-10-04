"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * The search screen downloads only when the header icon is tapped (or hovered or
 * focused, via `prefetchWorkSearchSheet`), so the header that every page loads
 * carries one icon and this wrapper, never the search or any area's code.
 */
const loadWorkSearchSheet = () =>
  import("@/components/work-search/work-search-sheet").then((module) => module.WorkSearchSheet);

const WorkSearchSheet = dynamic(loadWorkSearchSheet, { ssr: false });

export function prefetchWorkSearchSheet() {
  void loadWorkSearchSheet();
}

export function LazyWorkSearchSheet(props: ComponentProps<typeof WorkSearchSheet>) {
  return props.open ? <WorkSearchSheet {...props} /> : null;
}
