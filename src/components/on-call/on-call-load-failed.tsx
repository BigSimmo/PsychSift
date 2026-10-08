"use client";

import { CloudOff } from "lucide-react";

import { WorkStateNotice } from "@/components/mode-kit/work-state";

export interface OnCallLoadFailedProps {
  reason: "offline" | "failed" | null;
  onRetry: () => void;
  testId?: string;
}

/**
 * What a page shows when the entries could not be fetched and nothing is
 * cached from earlier in this session, drawn as the shared work-mode offline
 * or failed state. Until 2026-09-24 that case fell through to each
 * page's empty state ("Your On Call hub is empty", "No contacts yet"), which
 * told the reader their numbers were gone when the server had only failed to
 * answer.
 */
export function OnCallLoadFailed({ reason, onRetry, testId = "on-call-load-failed" }: OnCallLoadFailedProps) {
  return (
    <WorkStateNotice
      kind={reason === "offline" ? "offline" : "error"}
      icon={CloudOff}
      title="Couldn't load your On Call entries"
      body={
        reason === "offline"
          ? "You appear to be offline, and On Call entries are not saved on this device. Try again once you have signal."
          : "The server did not answer. Nothing has been lost; try again in a moment."
      }
      onRetry={onRetry}
      testId={testId}
    />
  );
}
