"use client";

import type { LucideIcon } from "lucide-react";

import { WorkSignInNotice } from "@/components/mode-kit/work-sign-in-notice";

export interface OnCallSignedOutProps {
  icon: LucideIcon;
  testId: string;
}

/**
 * What a signed-out reader sees in place of an On Call list, drawn as the
 * shared work-mode signed-out state.
 *
 * Shared entries are readable by signed-in users only (owner decision,
 * 2026-09-26), so the server answers a signed-out caller with an empty list.
 * Drawn as that section's ordinary empty state, it read as though the hub had
 * been wiped; this says why it is empty and offers the way in.
 */
export function OnCallSignedOut({ icon, testId }: OnCallSignedOutProps) {
  return (
    <WorkSignInNotice
      icon={icon}
      title="Sign in to see shared On Call entries"
      body="Signed-in users can see entries shared across services. Check the service before using a number."
      testId={testId}
    />
  );
}
