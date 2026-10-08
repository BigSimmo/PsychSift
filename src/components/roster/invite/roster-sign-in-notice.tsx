"use client";

import { LogIn } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { ModeNotice } from "@/components/mode-kit/notice";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/supabase/client";

/** The session when an `AuthProvider` is mounted; null in a bare render (unit tests). */
function useAuthSessionIfAvailable() {
  try {
    return useAuthSession();
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.") return null;
    throw error;
  }
}

function reloadPage() {
  window.location.reload();
}

/**
 * Roster's way in. The app has no sign-in page (`/sign-in` forwards to
 * Favourites), so "Sign in" opens the same account dialog On Call and Teaching
 * use. `open` starts it; render `dialog` beside the control that calls it.
 *
 * The Roster reads (shifts, teams, settings, swaps) fetch once on mount and
 * keep their signed-out answer, so a sign-in started here reloads the page
 * once the session turns authenticated; otherwise the screen would stay
 * signed out until the reader reloaded it themselves.
 */
export function useRosterSignIn(onSignedIn: () => void = reloadPage): {
  readonly open: () => void;
  readonly dialog: ReactNode;
} {
  const [isOpen, setOpen] = useState(false);
  const [askedWhileSignedOut, setAskedWhileSignedOut] = useState(false);
  const signedIn = useAuthSessionIfAvailable()?.status === "authenticated";
  useEffect(() => {
    if (askedWhileSignedOut && signedIn) onSignedIn();
  }, [askedWhileSignedOut, signedIn, onSignedIn]);
  return {
    open: () => {
      setOpen(true);
      if (!signedIn) setAskedWhileSignedOut(true);
    },
    // Mounted only once asked for, so a signed-out screen needs nothing from the session until then.
    dialog: isOpen ? <AccountSetupDialog open onClose={() => setOpen(false)} /> : null,
  };
}

/** A signed-out Roster screen: the reason in one line, and the way in. */
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
  const signIn = useRosterSignIn(onSignedIn);
  return (
    <div className="grid gap-2" data-testid={testId}>
      <ModeNotice>{children}</ModeNotice>
      <Button variant="primary" icon={LogIn} onClick={signIn.open} className="justify-self-start">
        Sign in
      </Button>
      {signIn.dialog}
    </div>
  );
}
