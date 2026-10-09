"use client";

import { useEffect, useState } from "react";

import { useAuthIfAvailable } from "@/lib/example-data/store";

/**
 * The signed-in reader's hospital-side roles, for the menu and the Courses organiser check. The roles
 * module loads on demand: imported here directly, it sat in every page's
 * first download and made the shared chunks split worse (about 145 KiB more
 * across the app). Signed out, or until the answer is in, no roles.
 */
export function useHeldWorkRoles(signedIn: boolean): readonly string[] {
  const userId = useAuthIfAvailable()?.session?.user?.id ?? null;
  const [held, setHeld] = useState<{ readonly userId: string; readonly roles: readonly string[] } | null>(null);
  useEffect(() => {
    if (!signedIn || !userId) return;
    let stop: (() => void) | null = null;
    let live = true;
    void import("@/lib/work-roles/use-work-roles").then(({ watchHeldWorkRoles }) => {
      if (live) stop = watchHeldWorkRoles(userId, (roles) => setHeld({ userId, roles }));
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [signedIn, userId]);
  return signedIn && held && held.userId === userId ? held.roles : NO_ROLES;
}

const NO_ROLES: readonly string[] = [];
