"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

import { cn, pageContainer } from "@/components/ui-primitives";
import { useAuthSession } from "@/lib/supabase/client";

/** The Now page, which shows its own banner. */
const ON_CALL_NOW_PATH = "/on-call";

/**
 * The signed-out sample box for On Call and Admin, drawn above their pages by
 * each mode's layout. Downloaded only when a signed-out visitor opens one of
 * those pages, so it never counts towards anyone's first load.
 */
const SignedOutBox = dynamic(() => import("@/components/on-call/on-call-sample-notice-box"), { ssr: false });

export function OnCallSampleNotice({ mode }: { readonly mode: "on-call" | "admin" }) {
  const { status } = useAuthSession();
  const pathname = usePathname();
  if (status !== "signed_out" && status !== "expired") return null;
  // Now draws its own "Made-up example" banner above the crisis lines
  // (`OnCallHome`), so a second sample box here would stack two Sign in buttons.
  if (mode === "on-call" && pathname === ON_CALL_NOW_PATH) return null;
  return (
    <div className={cn("bg-[color:var(--background)] px-3 pt-4 sm:px-5 lg:px-7")}>
      <div className={pageContainer}>
        <SignedOutBox mode={mode} />
      </div>
    </div>
  );
}
