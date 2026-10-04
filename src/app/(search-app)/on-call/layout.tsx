import type { ReactNode } from "react";

import { OnCallSampleNotice } from "@/components/on-call/on-call-sample-notice";

export default function OnCallLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OnCallSampleNotice mode="on-call" />
      {children}
    </>
  );
}
