"use client";

import { createContext, useContext } from "react";

/**
 * True below the signed-out sample gate: the Roster screens are showing the
 * invented sample, so the server-sample notices ("Example team...") that
 * would repeat or contradict the shared Sample box stay quiet.
 */
const RosterSignedOutSampleContext = createContext(false);

export const RosterSignedOutSampleProvider = RosterSignedOutSampleContext.Provider;

export function useRosterSignedOutSample(): boolean {
  return useContext(RosterSignedOutSampleContext);
}
