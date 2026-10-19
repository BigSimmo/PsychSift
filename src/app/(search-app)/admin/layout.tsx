import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";
import { OnCallExampleDataScope } from "@/lib/on-call/entry-store";
import type { Metadata } from "next";
import { PRIVATE_APP_ROBOTS_METADATA } from "@/lib/crawler-policy";

// Personal work area: kept out of search results (repository audit F-30).
export const metadata: Metadata = {
  robots: PRIVATE_APP_ROBOTS_METADATA,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ModeBand modeId="my-work" homePath="/admin">
      <OnCallExampleDataScope>{children}</OnCallExampleDataScope>
    </ModeBand>
  );
}
