"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

const loadNeedsYouModule = () => import("@/components/needs-you/needs-you-sheet");

const NeedsYouCentre = dynamic(() => loadNeedsYouModule().then((module) => module.NeedsYouCentre), { ssr: false });

export function prefetchNeedsYouSheet() {
  void loadNeedsYouModule();
}

/**
 * The bell's Notification centre, as a lazy chunk: the header carries only the
 * bell. Once mounted it reads the feed (for the badge) and draws the sheet
 * when `open`, so the badge and the sheet share one read.
 */
export function LazyNotificationCentre(props: ComponentProps<typeof NeedsYouCentre>) {
  return <NeedsYouCentre {...props} />;
}
