import type { ReactNode } from "react";

import { OnCallSampleNotice } from "@/components/on-call/on-call-sample-notice";
import { ModeBand } from "@/components/mode-band/mode-band";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ModeBand modeId="my-work" homePath="/admin">
      <OnCallSampleNotice mode="admin" />
      {children}
    </ModeBand>
  );
}
