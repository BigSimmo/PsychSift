"use client";

import { useEffect, useRef } from "react";

import { useOptionalToast } from "@/components/ui/toast";
import { useAuthSession } from "@/lib/supabase/client";

export const SIGN_IN_ENDED_TITLE = "Your sign-in ended";
export const SIGN_IN_ENDED_BODY =
  "To protect shared computers, this device's MHA clocks, drafts, notes and recent searches were cleared. Sign in again to carry on.";

/**
 * Says once, and until dismissed, that an ended sign-in cleared this device's private notes. The
 * clearing itself is the shared-workstation safeguard and stays; before this it happened without a
 * word (design audit D-04, owner yes 19 Oct 2026). Draws nothing itself: it uses the app's toast.
 */
export function SignInEndedNotice() {
  const { deviceDataClearedAt } = useAuthSession();
  const toast = useOptionalToast();
  const shownFor = useRef<number | null>(null);

  useEffect(() => {
    if (!toast || !deviceDataClearedAt || shownFor.current === deviceDataClearedAt) return;
    shownFor.current = deviceDataClearedAt;
    toast.push({ tone: "info", title: SIGN_IN_ENDED_TITLE, body: SIGN_IN_ENDED_BODY, duration: 0 });
  }, [deviceDataClearedAt, toast]);

  return null;
}
