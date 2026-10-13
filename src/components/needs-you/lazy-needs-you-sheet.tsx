"use client";

import dynamic from "next/dynamic";
import { memo, type ComponentProps } from "react";

const loadNeedsYouModule = () => import("@/components/needs-you/needs-you-sheet");

const NeedsYouCentre = dynamic(() => loadNeedsYouModule().then((module) => module.NeedsYouCentre), { ssr: false });

export function prefetchNeedsYouSheet() {
  void loadNeedsYouModule();
}

/**
 * The bell's Notification centre, as a lazy chunk: the header carries only the
 * bell. Once mounted it reads the feed (for the badge) and draws the sheet
 * when `open`, so the badge and the sheet share one read.
 *
 * Memoised because the header re-renders several times each time it slides
 * away or back on a scroll, and the feed read under it (every source, the
 * device time zone) is the heaviest part of that render. Its props are stable
 * (`open`, a callback, a ref and a state setter), so it re-renders only when
 * the bell itself changes.
 */
export const LazyNotificationCentre = memo(function LazyNotificationCentre(
  props: ComponentProps<typeof NeedsYouCentre>,
) {
  return <NeedsYouCentre {...props} />;
});
