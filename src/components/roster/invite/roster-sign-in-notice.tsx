"use client";

import type { ReactNode } from "react";

import { WorkSignInNotice } from "@/components/mode-kit/work-sign-in-notice";

function reloadPage() {
  window.location.reload();
}

/**
 * A signed-out Roster screen: the reason in one line, and the way in, drawn as
 * the shared work-mode signed-out state. The app has no sign-in page; "Sign in"
 * opens the same account dialog every work area uses.
 *
 * The Roster reads (shifts, teams, settings, swaps) fetch once on mount and
 * keep their signed-out answer, so a sign-in started here reloads the page
 * once the session turns authenticated; otherwise the screen would stay
 * signed out until the reader reloaded it themselves.
 */
export function RosterSignInNotice({
  children,
  testId,
  onSignedIn = reloadPage,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
  /** Runs once when a sign-in started from this notice succeeds. */
  readonly onSignedIn?: () => void;
}) {
  return <WorkSignInNotice title={children} onSignedIn={onSignedIn} role="status" testId={testId} />;
}
