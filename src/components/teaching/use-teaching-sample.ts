"use client";

import { useEffect, useState } from "react";

import { useExampleData } from "@/lib/example-data/store";
import { useAuthSession } from "@/lib/supabase/client";

/*
 * The Teaching sample is the default for a visitor who is not signed in. It is
 * decided here, in the browser, from the sign-in status: nothing is stored and
 * no cookie is set. Every Teaching screen already renders `demo-programme.ts`
 * and never calls the API when its `demoMode` is true, so a signed-out visitor
 * simply gets that switch turned on. Signed in, or in the local demo build
 * (status "unconfigured"), nothing changes.
 */

/** True when the reader is signed out or their sign-in has run out. */
export function useTeachingSignedOut(): boolean {
  const { status } = useAuthSession();
  return status === "signed_out" || status === "expired";
}

/**
 * What a Teaching screen reads as `demoMode`: the server's (local demo or the
 * example data cookie) or the example data switch, which client screens follow
 * at once, before the cookie sync refreshes the server pages. Auto mode already
 * shows examples to a signed-out visitor, and an explicit off is honoured: they
 * get Teaching's own sign-in notice.
 */
export function useTeachingDemoMode(serverDemoMode: boolean): boolean {
  const example = useExampleData("teach").active;
  return serverDemoMode || example;
}

/**
 * For the three screens that read through the API even in the demo (Resources, a
 * collection, What's on): the server fills in the sample only when the cookie is
 * on, so a signed-out visitor builds the same rows here, in the browser, from the
 * shipped demo files. The module loads only when asked for, so it adds nothing to
 * anyone's first download. Returns undefined until it is built; `active` false
 * returns undefined and builds nothing.
 */
export function useSignedOutSampleRead<T>(active: boolean, key: string | null, build: () => Promise<T>): T | undefined {
  const [built, setBuilt] = useState<{ key: string; data: T } | null>(null);
  useEffect(() => {
    if (!active || !key) return;
    let current = true;
    build().then(
      (data) => {
        if (current) setBuilt({ key, data });
      },
      () => {},
    );
    return () => {
      current = false;
    };
    // `build` closes over `key` only; it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);
  return active && built?.key === key ? built.data : undefined;
}
