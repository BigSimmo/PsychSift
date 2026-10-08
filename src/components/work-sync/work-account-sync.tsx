"use client";

import { useEffect, useRef } from "react";

import { useAuthSession } from "@/lib/supabase/client";
import { startWorkSync } from "@/lib/work-sync/work-sync-client";

/**
 * Runs the work-choices sync (`@/lib/work-sync/work-sync-client`) while a
 * doctor is signed in, and stops it the moment they are not. Renders nothing.
 */
export function WorkAccountSync() {
  const { status, authorizationHeader, authEpoch, isAuthEpochCurrent } = useAuthSession();

  // A refreshed token changes the header, not the account: read it fresh on each request.
  const headers = useRef(authorizationHeader);
  useEffect(() => {
    headers.current = authorizationHeader;
  }, [authorizationHeader]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const epoch = authEpoch;
    return startWorkSync({ headers: () => headers.current, isCurrent: () => isAuthEpochCurrent(epoch) });
  }, [status, authEpoch, isAuthEpochCurrent]);

  return null;
}
