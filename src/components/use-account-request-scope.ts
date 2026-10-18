"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

import { useAuthSession } from "@/lib/supabase/client";

function useOptionalAuth() {
  try {
    return useAuthSession();
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.") return null;
    throw error;
  }
}

/** Capture the identity of a callback, including callbacks retained by queues or timers. */
export function useAccountRequestScope() {
  const auth = useOptionalAuth();
  const scope = auth ? `${auth.authEpoch}:${auth.status}:${auth.session?.user.id ?? ""}` : "standalone";
  const epoch = auth?.authEpoch;
  const isAuthEpochCurrent = auth?.isAuthEpochCurrent;
  const current = useRef<string | null>(scope);
  useLayoutEffect(() => {
    current.current = scope;
    return () => {
      current.current = null;
    };
  }, [scope]);
  const isCurrent = useCallback(
    () => current.current === scope && (epoch === undefined || !isAuthEpochCurrent || isAuthEpochCurrent(epoch)),
    [epoch, isAuthEpochCurrent, scope],
  );
  return { scope, isCurrent };
}
