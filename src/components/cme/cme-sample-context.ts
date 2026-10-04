"use client";

import { createContext, useContext } from "react";

/**
 * True only inside the signed-out CPD sample. The sample keeps nothing, so a form
 * inside it must not mirror what a visitor types into the browser's tab storage.
 */
export const CmeSampleContext = createContext(false);

export function useCmeSample(): boolean {
  return useContext(CmeSampleContext);
}
