"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/components/ui/button";

// The sign-in dialog loads only when someone asks for it.
const AccountSetupDialog = dynamic(
  () => import("@/components/clinical-dashboard/account-setup-dialog").then((module) => module.AccountSetupDialog),
  { ssr: false },
);

/** The one filled button on a signed-out example page. */
export function SignInAction({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 px-3 pb-6">
      <Button variant="primary" block onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? <AccountSetupDialog open onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
