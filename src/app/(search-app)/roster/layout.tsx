import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

export default function RosterLayout({ children }: { children: ReactNode }) {
  return <ModeBand modeId="roster">{children}</ModeBand>;
}
