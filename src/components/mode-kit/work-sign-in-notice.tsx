"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { WorkStateNotice } from "@/components/mode-kit/work-state";
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

/**
 * Mounted once Sign in is chosen, so a signed-out screen reads nothing from the
 * session until then. Calls `onSignedIn` once if the session was signed out
 * when it mounted and turns authenticated later.
 */
function RefreshOnSignIn({ onSignedIn }: { readonly onSignedIn: () => void }) {
  const signedIn = useAuthSessionIfAvailable()?.status === "authenticated";
  const [startedSignedOut] = useState(!signedIn);
  useEffect(() => {
    if (startedSignedOut && signedIn) onSignedIn();
  }, [startedSignedOut, signedIn, onSignedIn]);
  return null;
}

/**
 * The shared signed-out state with the way in: "Sign in" opens the app's own
 * account dialog (there is no sign-in page), the same in every work area.
 *
 * `onSignedIn` is for an area whose reads fetched once on mount and kept their
 * signed-out answer (Roster): it runs once a sign-in started here succeeds, so
 * the page does not stay on this notice until the reader reloads it.
 */
export function WorkSignInNotice({
  title,
  body,
  icon,
  signInLabel,
  signInTestId,
  onSignedIn,
  action,
  role,
  bare,
  testId,
}: {
  readonly title: ReactNode;
  readonly body?: ReactNode;
  readonly icon?: LucideIcon;
  readonly signInLabel?: string;
  readonly signInTestId?: string;
  readonly onSignedIn?: () => void;
  readonly action?: ReactNode;
  readonly role?: "status" | "alert" | null;
  readonly bare?: boolean;
  readonly testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  return (
    <>
      <WorkStateNotice
        kind="signed-out"
        title={title}
        body={body}
        icon={icon}
        signInLabel={signInLabel}
        signInTestId={signInTestId}
        onSignIn={() => {
          setOpen(true);
          setAsked(true);
        }}
        action={action}
        role={role}
        bare={bare}
        testId={testId}
      />
      {asked && onSignedIn ? <RefreshOnSignIn onSignedIn={onSignedIn} /> : null}
      {/* Mounted only once asked for, so a signed-out screen needs nothing from the session until then. */}
      {open ? <AccountSetupDialog open onClose={() => setOpen(false)} /> : null}
    </>
  );
}
