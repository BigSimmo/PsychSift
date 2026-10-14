import type { ReactNode } from "react";

import { DeveloperAreaGate } from "@/components/developer-area/developer-area-gate";

export default function DevelopmentLayout({ children }: { children: ReactNode }) {
  return <DeveloperAreaGate>{children}</DeveloperAreaGate>;
}
