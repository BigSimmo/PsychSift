import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

export default function MyDayLayout({ children }: { children: ReactNode }) {
  return (
    <ModeBand modeId="my-day" lead={{ kind: "date" }} title="greeting">
      {children}
    </ModeBand>
  );
}
