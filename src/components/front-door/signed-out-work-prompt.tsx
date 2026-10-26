"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useOptionalToast } from "@/components/ui/toast";
import { useAuthSession } from "@/lib/supabase/client";

export const SIGNED_OUT_WORK_TITLE = "Keep what's on this phone?";
export const SIGNED_OUT_WORK_BODY =
  "Before you signed in, bed numbers or initials were saved on this phone in call notes, handover drafts or timers. Keep them with your account for this shift, or clear them now. Kept ones still clear when the shift ends.";

/**
 * Asks, once per sign-in, whether the signed-out work on this phone stays (design audit D26-02).
 * Closing the sheet keeps it, because clearing cannot be undone; Clear them is the deliberate step.
 */
export function SignedOutWorkPrompt() {
  const { signedOutWorkHeld, resolveSignedOutWork } = useAuthSession();
  const toast = useOptionalToast();
  if (!resolveSignedOutWork) return null;

  const answer = (keep: boolean) => {
    resolveSignedOutWork(keep);
    toast?.push({
      tone: "info",
      title: keep ? "Kept with your account" : "Cleared from this phone",
      body: keep ? "They clear when your shift ends or you sign out." : undefined,
    });
  };

  return (
    <ConfirmDialog
      open={Boolean(signedOutWorkHeld)}
      onCancel={() => answer(true)}
      onConfirm={() => answer(false)}
      title={SIGNED_OUT_WORK_TITLE}
      description={SIGNED_OUT_WORK_BODY}
      cancelLabel="Keep with my account"
      confirmLabel="Clear them"
    />
  );
}
