"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { useExampleData } from "@/lib/example-data/store";

/*
 * The signed-out module: Sign in opens the app's own sign-in dialog; "Open the
 * demo" turns the one example data switch on (every work area, not a
 * Teaching-only cookie) and refreshes, so server-rendered pages re-read.
 */
export function TeachingSignInNotice() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { turnOn } = useExampleData("teach");
  return (
    <>
      <TeachingStateNotice
        state="signed-out"
        onSignIn={() => setOpen(true)}
        onOpenDemo={() => {
          turnOn();
          router.refresh();
        }}
      />
      <AccountSetupDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
