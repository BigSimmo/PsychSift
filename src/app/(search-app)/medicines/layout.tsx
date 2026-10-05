import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

export default function MedicinesLayout({ children }: { children: ReactNode }) {
  return (
    <ModeBand modeId="medicines" lead={{ kind: "date" }}>
      {children}
    </ModeBand>
  );
}
