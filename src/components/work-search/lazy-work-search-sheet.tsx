"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * The search screen is never part of the header's own code: the header that every
 * page loads carries one icon and this wrapper. The screen is fetched once the
 * browser is idle, or when the icon is hovered, focused or tapped (via
 * `prefetchWorkSearchSheet`), so the first tap opens it at once.
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

/** The keyboard list ("?"), loaded the first time it is asked for. */
const WorkSearchKeys = dynamic(
  () => import("@/components/work-search/work-search-keys").then((module) => module.WorkSearchKeys),
  { ssr: false },
);

export function LazyWorkSearchKeys(props: ComponentProps<typeof WorkSearchKeys>) {
  return props.open ? <WorkSearchKeys {...props} /> : null;
}
