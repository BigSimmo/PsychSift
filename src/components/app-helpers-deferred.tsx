"use client";

import dynamic from "next/dynamic";

/*
 * Open where you were, keyboard shortcuts and page motion (site recommendations,
 * 12 Oct 2026). None of them draws anything a page needs to show, so they load
 * just after the page instead of adding to every page's first download.
 */
const LastPlace = dynamic(() => import("@/components/last-place/last-place").then((m) => m.LastPlace), {
  ssr: false,
});
const KeyboardShortcuts = dynamic(
  () => import("@/components/keyboard-shortcuts/keyboard-shortcuts").then((m) => m.KeyboardShortcuts),
  { ssr: false },
);
const MotionEnter = dynamic(() => import("@/components/motion/motion-enter").then((m) => m.MotionEnter), {
  ssr: false,
});

export function AppHelpersDeferred() {
  return (
    <>
      <LastPlace />
      <KeyboardShortcuts />
      <MotionEnter />
    </>
  );
}
