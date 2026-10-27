"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useOptionalToast } from "@/components/ui/toast";
import { SLOW_SIGN_IN_COOKIE } from "@/lib/supabase/auth-deadline";

export const SLOW_SIGN_IN_TITLE = "Sign-in is slow right now";
export const SLOW_SIGN_IN_BODY =
  "Checking your sign-in took too long, so this page opened as signed out. Try again in a moment.";

/** True once, when the proxy marked this page as opened signed out after its sign-in check ran out of time. */
function takeSlowSignInFlag(): boolean {
  const match = new RegExp(`(?:^|; )${SLOW_SIGN_IN_COOKIE}=1(?:;|$)`).test(document.cookie);
  if (match) document.cookie = `${SLOW_SIGN_IN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  return match;
}

/**
 * Says why a signed-in doctor is looking at a signed-out page when the server's 4 second sign-in
 * limit was reached (performance audit H1; owner "Build" 27 Oct 2026). Without it a slow sign-in
 * looks like being logged out. Never shows on a normal signed-out visit: the proxy sets the flag only
 * for a reader with a session cookie whose check timed out. Try again reloads the page.
 */
export function SlowSignInNotice() {
  const toast = useOptionalToast();
  // The root layout that holds this note stays mounted across in-app navigation, and each navigation
  // passes the proxy again, so the flag is checked after every one, not only on first load.
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";

  useEffect(() => {
    if (!toast || !takeSlowSignInFlag()) return;
    toast.push({
      tone: "warning",
      title: SLOW_SIGN_IN_TITLE,
      body: SLOW_SIGN_IN_BODY,
      duration: 0,
      action: { label: "Try again", onAction: () => window.location.reload() },
    });
  }, [toast, pathname, search]);

  return null;
}
