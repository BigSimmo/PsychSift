"use client";

import { createContext, useContext } from "react";

/**
 * Kept apart from `mode-band.tsx` so the shared header portals can ask whether
 * a band is showing without importing the band itself.
 */
export const ModeBandShownContext = createContext(false);

/**
 * Whether this page sits under a mode band. Decided from the address alone, so
 * the server and the browser agree on the first paint. Pages use it to drop
 * their own copy of something the band now carries (a visible title, a
 * Customise button), so nothing shows twice, and keep it where no band is.
 */
export function useModeBandShown(): boolean {
  return useContext(ModeBandShownContext);
}
