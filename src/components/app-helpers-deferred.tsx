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
const TermsAcceptancePrompt = dynamic(
  () => import("@/components/front-door/terms-acceptance-prompt").then((m) => m.TermsAcceptancePrompt),
  { ssr: false },
);
const SignInEndedNotice = dynamic(
  () => import("@/components/front-door/sign-in-ended-notice").then((m) => m.SignInEndedNotice),
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
      {/* Asks a signed-in user to accept the current Terms of Use, once per version. */}
      <TermsAcceptancePrompt />
      {/* Says when an ended sign-in cleared this device's private notes. */}
      <SignInEndedNotice />
    </>
  );
}
