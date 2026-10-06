"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

const loadNeedsYouSheet = () => import("@/components/needs-you/needs-you-sheet").then((module) => module.NeedsYouSheet);

const NeedsYouSheet = dynamic(loadNeedsYouSheet, { ssr: false });

export function prefetchNeedsYouSheet() {
  void loadNeedsYouSheet();
}

export function LazyNeedsYouSheet(props: ComponentProps<typeof NeedsYouSheet>) {
  return props.open ? <NeedsYouSheet {...props} /> : null;
}
