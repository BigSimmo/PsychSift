"use client";

import { useCallback, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { patientLabelsOnDevice } from "@/lib/patient-label-storage";

export const SIGN_OUT_CONFIRM_TITLE = "Sign out and clear this phone?";

/**
 * Sign out, but first say what goes when this phone still holds the shift's bed numbers and
 * initials (D26-26). With nothing to lose it signs out at once, so the common case stays one tap.
 */
export function useSignOutConfirm(signOut: () => void) {
  const [open, setOpen] = useState(false);
  const requestSignOut = useCallback(() => {
    if (patientLabelsOnDevice()) setOpen(true);
    else signOut();
  }, [signOut]);
  const dialog = (
    <ConfirmDialog
      open={open}
      onCancel={() => setOpen(false)}
      onConfirm={() => {
        setOpen(false);
        signOut();
      }}
      title={SIGN_OUT_CONFIRM_TITLE}
      description="Signing out clears the bed numbers and initials kept on this phone for this shift, including call notes, handover drafts and timers. They cannot be brought back. Display settings stay."
      confirmLabel="Sign out and clear"
    />
  );
  return { requestSignOut, dialog } as const;
}
