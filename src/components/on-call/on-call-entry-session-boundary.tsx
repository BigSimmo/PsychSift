"use client";

import { Fragment, useState, type ReactNode } from "react";

import { createBrowserStore } from "@/lib/client-store-factory";
import { onCallEntryCacheChangedEvent, peekOnCallEntrySessionEpoch } from "@/lib/on-call/entry-cache-keys";

const useEntrySessionEpoch = createBrowserStore(
  (onChange) => {
    window.addEventListener(onCallEntryCacheChangedEvent, onChange);
    return () => window.removeEventListener(onCallEntryCacheChangedEvent, onChange);
  },
  peekOnCallEntrySessionEpoch,
  0,
);

/**
 * Page selections, drafts and Undo belong to the session that opened them.
 * Pages remount on a transition. An open sheet stays closed after a transition
 * until its caller explicitly closes/reopens it, so old entry props cannot
 * seed a new account's draft. Closing in the same session keeps draft state.
 */
export function OnCallEntrySessionBoundary({ children, open }: { children: ReactNode; open?: boolean }) {
  const epoch = useEntrySessionEpoch();
  const [draftEpoch, setDraftEpoch] = useState(epoch);
  if (open === false && draftEpoch !== epoch) setDraftEpoch(epoch);
  if (open !== undefined && draftEpoch !== epoch) return null;
  return <Fragment key={epoch}>{children}</Fragment>;
}
