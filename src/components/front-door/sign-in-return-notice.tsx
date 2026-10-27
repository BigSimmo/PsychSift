"use client";

import { useEffect, useRef } from "react";

import { useOptionalToast } from "@/components/ui/toast";
import { useAuthSession } from "@/lib/supabase/client";

export const SIGN_IN_RETURN_TITLE = "You're not signed in";

/**
 * Says why a sign-in link or provider return failed, on whatever page it landed on. Before this
 * the reason was kept for the account dialog only, so a link opened in the wrong browser (a phone's
 * email app often uses its own) landed on the sign-in card with no word about what went wrong.
 * Draws nothing itself: it uses the app's toast, and stays until dismissed or until sign-in works.
 */
export function SignInReturnNotice() {
  const { signInReturnError, status } = useAuthSession();
  const toast = useOptionalToast();
  const shownFor = useRef<string | null>(null);
  const toastId = useRef<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    if (status === "authenticated") {
      if (toastId.current) toast.dismiss(toastId.current);
      toastId.current = null;
      return;
    }
    if (!signInReturnError || shownFor.current === signInReturnError) return;
    shownFor.current = signInReturnError;
    toastId.current = toast.push({
      tone: "warning",
      title: SIGN_IN_RETURN_TITLE,
      body: signInReturnError,
      duration: 0,
    });
  }, [signInReturnError, status, toast]);

  return null;
}
