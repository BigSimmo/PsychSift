import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";
import { OnCallExampleDataScope } from "@/lib/on-call/entry-store";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ModeBand modeId="my-work" homePath="/admin">
      <OnCallExampleDataScope>{children}</OnCallExampleDataScope>
    </ModeBand>
  );
}
